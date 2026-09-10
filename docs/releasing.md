# Release Guide

The proposed distribution name is `signal-risk-sdk`, import name `signal_sdk`,
CLI `signal-sdk`, initial version `0.1.0`. No official PyPI publication has been
performed. Check name availability and the intended PyPI owner before publishing.

## Verify the Source

```sh
python -m pip install -e '.[dev]'
ruff check src tests
pytest -q
signal-sdk validate
signal-sdk demo --episodes 48 --output outputs/release-check
python examples/paired_comparison.py
python -m build
```

CI tests Python 3.11, 3.12 and 3.13 and builds the wheel and source distribution.
The local checked environment may differ; inspect the actual CI results before
calling a release compatible across those versions. On machines with a heavily
threaded BLAS, `OPENBLAS_NUM_THREADS=1` can avoid oversubscription for small models.

Install the wheel in a fresh environment and verify `import signal` still loads
the standard library, while `import signal_sdk` loads this SDK. Inspect package
contents for accidental credentials, outputs, caches or unrelated source.

Review the assumptions and validation acceptance criteria in
[statistics.md](statistics.md), particularly severity, top-cluster independence,
approximate difficulty uncertainty and new-book prediction. Test the actual
provider adapter and constructed distribution before using them for real reports.

## Publication Is Separate

1. Agree on package name, ownership, version and release notes.
2. Review the build and CI results and approve official publication.
3. Configure PyPI trusted publishing for this repository, or use an authorized
   release identity. Do not commit credentials.
4. Publish the already-reviewed artifacts and verify installation from PyPI.

There is deliberately no automatic publishing workflow in this repository.
Creating or pushing the GitHub repository does not publish a pip package.
