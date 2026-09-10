"""Run with python examples/invoice_book.py after installing the SDK."""

from pathlib import Path

from signal_sdk.certificate import export_certificates
from signal_sdk.examples import demo
from signal_sdk.visualization import export_html

measurement = demo(count=48, seed=7)
output = Path("outputs/invoice_book")
output.mkdir(parents=True, exist_ok=True)
(output / "measurement.json").write_text(measurement.model_dump_json(indent=2), encoding="utf-8")
export_certificates(measurement, output / "certificates")
export_html(measurement, output / "traces.html")
print(output.resolve())
