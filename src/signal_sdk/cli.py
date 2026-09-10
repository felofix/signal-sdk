"""Local command line interface. No provider calls are made by demo or validate."""

import argparse
import json
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="signal-sdk", description="Constructed function risk measurement")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="Run simulation PASS/FAIL checks")
    validate.add_argument("--seed", type=int, default=1729)
    demo = sub.add_parser("demo", help="Run a constructed simulation plus domain controls")
    demo.add_argument("--episodes", type=int, default=48)
    demo.add_argument("--seed", type=int, default=7)
    demo.add_argument("--repetitions", type=int, default=3)
    demo.add_argument("--output", type=Path, default=Path("outputs/demo"))
    demo.add_argument("--no-variants", action="store_true")
    demo.add_argument("--generic", action="store_true",
                      help="Run the default return-value domain on an arithmetic book instead of payments")
    report = sub.add_parser("report", help="Generate certificates and HTML from a snapshot")
    report.add_argument("measurement", type=Path)
    report.add_argument("--output", type=Path, default=Path("outputs/report"))
    compare = sub.add_parser("compare", help="Compare pre/post snapshots using their bound plan")
    compare.add_argument("pre", type=Path)
    compare.add_argument("post", type=Path)
    compare.add_argument("--output", type=Path, default=Path("outputs/comparison.json"))
    power = sub.add_parser("power", help="Plan episodes for a currency margin before execution")
    power.add_argument("--margin", type=float, required=True)
    power.add_argument("--paired-sd", type=float, required=True)
    power.add_argument("--cluster-size", type=float, default=1.)
    power.add_argument("--icc", type=float, default=0.)
    serve = sub.add_parser("dashboard", help="Serve the local measurement API and trace explorer")
    serve.add_argument("--data", type=Path, default=Path("outputs/store"))
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8080)
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            from .validation import self_validate
            result = self_validate(args.seed)
            print(json.dumps(result, indent=2))
            return 0 if result["status"] == "PASS" else 1
        if args.command == "power":
            from .statistics import sample_size
            print(json.dumps(sample_size(args.margin, args.paired_sd, icc=args.icc, cluster_size=args.cluster_size), indent=2))
            return 0
        if args.command == "dashboard":
            import uvicorn
            from .dashboard.app import create_app
            uvicorn.run(create_app(args.data), host=args.host, port=args.port)
            return 0
        if args.command == "compare":
            from .certificate import compare_measurements
            from .models import Measurement
            result = compare_measurements(Measurement.model_validate_json(args.pre.read_text()),
                                          Measurement.model_validate_json(args.post.read_text()))
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(args.output.resolve())
            return 0
        from .certificate import export_certificates
        from .dashboard.store import DashboardStore
        from .models import Measurement
        from .visualization import export_html
        if args.command == "demo":
            from .examples import arithmetic_demo, demo
            measurement = (arithmetic_demo(args.episodes, args.seed, args.repetitions) if args.generic
                           else demo(args.episodes, args.seed, args.repetitions, not args.no_variants))
        else:
            measurement = Measurement.model_validate_json(args.measurement.read_text())
        args.output.mkdir(parents=True, exist_ok=True)
        snapshot = args.output / "measurement.json"
        snapshot.write_text(measurement.model_dump_json(indent=2), encoding="utf-8")
        DashboardStore(args.output / "store").put(measurement)
        trace = export_html(measurement, args.output / "traces.html")
        export_certificates(measurement, args.output / "certificates")
        print(f"Measurement: {snapshot.resolve()}\nTraces: {trace.resolve()}\nCertificates: {(args.output / 'certificates').resolve()}")
        return 0
    except (ValueError, RuntimeError, ImportError) as error:
        parser.exit(1, f"signal-sdk: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
