"""Logistic mixed effects for trajectory difficulty and new-book prediction."""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd
from scipy.linalg import solve_triangular
from scipy.special import expit
from statsmodels.genmod.bayes_mixed_glm import BinomialBayesMixedGLM

from .core import Rows, validate_rows


def _fit(frame: pd.DataFrame) -> Any:
    model = BinomialBayesMixedGLM.from_formula(
        "correct ~ C(function_id) * C(label)",
        {"cluster": "0 + C(cluster)", "trajectory": "0 + C(trajectory_id)",
         "trajectory_function": "0 + C(cell)"}, frame, vcp_p=.5, fe_p=2,
    )
    size = model.k_fep + model.k_vcp + model.k_vc
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="overflow encountered")
        fit = model.fit_vb(mean=np.zeros(size), sd=np.full(size, .3),
                           minim_opts={"maxiter": 600})
    if not fit.optim_retvals.success or not np.isfinite(fit.params).all():
        raise RuntimeError("Mixed model did not converge; increase the book or inspect the design")
    return fit


def _posterior_interval(values: np.ndarray) -> list[float]:
    return list(map(float, np.quantile(values, [.025, .975])))


def _joint_draws(fit: Any, draws: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    model = fit.model
    design = np.column_stack((model.exog, model.exog_vc.toarray()))
    center = np.r_[fit.fe_mean, fit.vc_mean]
    probability = expit(design @ center)
    weights = probability * (1 - probability)
    prior_precision = np.r_[np.full(model.k_fep, 1 / 4),
                            np.exp(-2 * fit.vcp_mean[model.ident])]
    precision = design.T @ (weights[:, None] * design) + np.diag(prior_precision)
    cholesky = np.linalg.cholesky(precision)
    perturbations = solve_triangular(cholesky.T, rng.normal(size=(len(center), draws)), lower=False).T
    joint = center + perturbations
    return joint[:, :model.k_fep], joint[:, model.k_fep:]


def difficulty(rows: Rows, *, seed: int = 0, future_trajectories: int = 10000,
               draws: int = 1000) -> dict[str, Any]:
    """Fit a regularized binomial mixed model; all intervals here are Bayesian.

    Empirical difficulty for a function is refitted after excluding its trials.
    The prediction model samples new clusters, trajectories, and trajectory/function
    effects, as well as parameter uncertainty and Bernoulli outcomes.
    """
    validate_rows(rows)
    if future_trajectories < 1 or draws < 100:
        raise ValueError("A positive horizon and at least 100 posterior draws are required")
    frame = pd.DataFrame([{k: r[k] for k in
                          ("trajectory_id", "function_id", "cluster", "label", "correct")} for r in rows])
    frame["correct"] = frame["correct"].astype(int)
    frame["cell"] = frame["trajectory_id"] + "::" + frame["function_id"]
    if frame.trajectory_id.nunique() < 12 or frame.function_id.nunique() < 2 or frame.cluster.nunique() < 4:
        return {"status": "insufficient_data", "reason": "Need 12 trajectories, two functions and four clusters",
                "empirical_difficulty": {}, "predictions": {}}
    try:
        fit = _fit(frame)
    except RuntimeError as exc:
        return {"status": "not_estimable", "reason": str(exc), "empirical_difficulty": {}, "predictions": {}}
    model = fit.model
    rng = np.random.default_rng(seed)
    # Fixed intercepts and trajectory effects are strongly correlated. Independent
    # variational draws lose their cancellation on the measured book and can
    # invert the relationship between finite-book and new-book uncertainty.
    # Recover joint conditional covariance from the logistic posterior Hessian.
    fixed, random_effects = _joint_draws(fit, draws, rng)
    log_sd = rng.normal(fit.vcp_mean, fit.vcp_sd, (draws, model.k_vcp))
    variances = np.exp(2 * log_sd)
    mean_variances = {name: float(np.exp(2 * value)) for name, value in zip(model.vcp_names, fit.vcp_mean)}
    empirical: dict[str, Any] = {}
    for function_id in sorted(frame.function_id.unique()):
        training = frame[frame.function_id != function_id].copy()
        try:
            without = _fit(training)
        except RuntimeError as exc:
            empirical[function_id] = {"status": "not_estimable", "reason": str(exc)}
            continue
        predictor = without.model.exog @ without.fe_mean + without.model.exog_vc @ without.vc_mean
        work = training.copy()
        work["estimated_failure"] = 1 - expit(predictor)
        leave_fixed, leave_random = _joint_draws(without, draws, rng)
        failure_draws = 1 - expit(leave_fixed @ without.model.exog.T
                                 + np.asarray(without.model.exog_vc @ leave_random.T).T)
        trajectory_intervals = {str(trajectory): _posterior_interval(failure_draws[:, np.flatnonzero(training.trajectory_id.to_numpy() == trajectory)].mean(axis=1))
                             for trajectory in training.trajectory_id.unique()}
        empirical[function_id] = {
            "status": "estimated", "excluded_function_id": function_id,
            "training_function_ids": sorted(training.function_id.unique()),
            "trajectories": {str(e): float(v) for e, v in
                         work.groupby("trajectory_id").estimated_failure.mean().items()},
            "trajectory_intervals": trajectory_intervals,
            "interpretation": "Predicted failure on the other measured functions; the assessed function's trials were excluded before fitting.",
        }
    observed = frame.drop_duplicates(["trajectory_id", "function_id"])
    fitted_fixed = model.exog @ fit.fe_mean
    label_frame = frame.assign(fixed=fitted_fixed)
    label_means = label_frame.groupby("label").fixed.mean()
    label_variance = float(np.var([label_means[label] for label in frame.label]))
    denominator = label_variance + sum(mean_variances.values()) + np.pi ** 2 / 3
    label_design = np.vstack([model.exog[frame.label.to_numpy() == label].mean(axis=0)
                              for label in frame.label])
    label_draw_variance = (fixed @ label_design.T).var(axis=1)
    label_fraction_draws = label_draw_variance / (label_draw_variance + variances.sum(axis=1) + np.pi ** 2 / 3)
    predictions = {}
    rates = {}
    # Integrate trajectory effects for finite-book means. For a future book,
    # retain the observed label mix and cluster-size assumption, sampling new effects.
    cluster_size = max(1, round(frame.trajectory_id.nunique() / frame.cluster.nunique()))
    for function_id in sorted(frame.function_id.unique()):
        indices = observed.index[observed.function_id == function_id].to_numpy()
        x = model.exog[indices]
        z = model.exog_vc[indices]
        finite_probabilities = expit(fixed @ x.T + np.asarray(z @ random_effects.T).T)
        finite_mean = finite_probabilities.mean(axis=1)
        future_rates = np.empty(draws)
        future_expected = np.empty(draws)
        # Posterior predictive simulation includes fresh trajectory difficulty,
        # function-specific trajectory effects and correlated cluster effects.
        for d in range(draws):
            chosen = rng.integers(0, len(x), future_trajectories)
            linear = x[chosen] @ fixed[d]
            new_clusters = (future_trajectories + cluster_size - 1) // cluster_size
            effects = rng.normal(0, np.sqrt(variances[d, 0]), new_clusters)
            linear += np.repeat(effects, cluster_size)[:future_trajectories]
            linear += rng.normal(0, np.sqrt(variances[d, 1] + variances[d, 2]), future_trajectories)
            probability = expit(linear)
            future_expected[d] = probability.mean()
            future_rates[d] = rng.binomial(1, probability).mean()
        finite_interval = _posterior_interval(finite_mean)
        predictive_interval = _posterior_interval(future_rates)
        wider = np.ptp(predictive_interval) > np.ptp(finite_interval)
        predictions[function_id] = {
            "observed_book_expected_correct_rate": {"estimate": float(finite_mean.mean()),
                                                     "interval": finite_interval},
            "next_book_correct_rate": {"estimate": float(future_rates.mean()),
                                       "interval": predictive_interval},
            "next_book_correct_count": {"estimate": float(future_rates.mean() * future_trajectories),
                                         "interval": [v * future_trajectories for v in predictive_interval]},
            "prediction_wider_than_measured_interval": bool(wider),
            "status": "estimated" if wider else "prediction_width_check_failed",
        }
        mask_function = frame.function_id.to_numpy() == function_id
        rates[function_id] = {}
        for label in sorted(frame.label.unique()):
            indices_label = np.flatnonzero(mask_function & (frame.label.to_numpy() == label))
            x_label = model.exog[indices_label].mean(axis=0)
            probabilities = expit(fixed @ x_label)
            rates[function_id][str(label)] = {"estimate": float(probabilities.mean()),
                                            "interval": _posterior_interval(probabilities)}
    return {
        "status": "estimated", "method": "Bayesian binomial mixed model; variational means and variance components with joint conditional Laplace coefficient covariance",
        "formula": "correct ~ function * label + (1|cluster) + (1|trajectory) + (1|trajectory:function)",
        "interval_kind": "95% approximate posterior credible/predictive intervals, not frequentist confidence intervals",
        "priors": {"fixed_effect_normal_sd": 2, "log_random_effect_sd_normal_sd": .5},
        "fixed_effects": {name: {"estimate": float(mean), "interval": _posterior_interval(fixed[:, index])}
                          for index, (name, mean) in enumerate(zip(model.exog_names, fit.fe_mean))},
        "variance_components": mean_variances, "label_explained_latent_fraction": label_variance / denominator,
        "label_explained_latent_fraction_interval": _posterior_interval(label_fraction_draws),
        "label_explained_definition": "Variance of label-specific mean fixed log-odds / (that variance + random-effect variances + logistic residual variance)",
        "function_by_label_correct_probability_at_zero_random_effect": rates,
        "empirical_difficulty": empirical, "predictions": predictions,
        "future_trajectories": future_trajectories, "posterior_draws": draws,
        "future_cluster_size_assumption": cluster_size,
        "assumptions": ["Random intercepts are independent Gaussian components conditional on the fixed effects.",
                        "The future book retains the observed label mixture and mean cluster size.",
                        "Variance components use a mean-field approximation; coefficient covariance is conditional on their posterior means. Hyperparameter-coefficient correlations remain approximate; this model is exploratory.",
                        "No discrimination parameter is estimated.",
                        "A failed prediction-width check is reported, never repaired by artificially widening an interval."],
    }
