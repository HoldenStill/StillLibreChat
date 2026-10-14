# Telemetry, CSV & Waveform Artifact Viewers

This document describes the integrated **WaveDrom Digital Timing Diagram Viewer** and **CSV Time-Series Telemetry Chart Viewer**, along with sample snippets to test both inline and in the Artifacts side panel.

---

## 1. WaveDrom Digital Logic & Timing Diagram Viewer

### 1.1 Supported Formats
The `WaveDromViewer` component (`client/src/components/Artifacts/WaveDromViewer.tsx`) renders digital timing diagrams for SPI, I2C, UART, AXI, and custom FPGA/ASIC bus waveforms:
- **Inline Fenced Code Blocks**: ```` ```wavejson ````, ```` ```wavedrom ````, or ```` ```application/vnd.wavedrom ````
- **Side-Panel Artifacts**: `:::artifact{type="application/vnd.wavedrom" title="SPI Bus Timing"}` or `:::artifact{type="wavejson" title="UART Frame"}`
- **File Attachments**: `.wavejson` and `.wavedrom` files

### 1.2 Supported WaveJSON Features
- **Clocks**: `p`, `P` (positive clock with rising-edge arrow), `n`, `N` (negative clock with falling-edge arrow)
- **Logic Levels**: `0` / `l` / `L` (low), `1` / `h` / `H` (high), `u` (pull-up), `d` (pull-down)
- **Bus / Data Envelopes**: `=`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9` mapped to semantic theme palette tokens (`--series-1` through `--series-8`) with automatic label extraction from `data`
- **Tri-State & Undefined**: `z` (high-impedance mid-line), `x` (hatched undefined region)
- **Continuations & Breaks**: `.` (extend previous state), `|` (cycle gap indicator)
- **Signal Groups, `period`, `phase`, `head.tick`, `foot.tock`, and `config.hscale`**
- **Interactive Controls**: Zoom In, Zoom Out, Reset Zoom, Source/Preview Toggle (inline), and **Export SVG**.

### 1.3 Sample WaveJSON Snippet

````markdown
```wavejson
{
  "head": { "text": "SPI Mode 0 Read Transaction", "tick": 0 },
  "signal": [
    ["SPI Bus",
      { "name": "CS_N", "wave": "10........1" },
      { "name": "SCLK", "wave": "0.P.......0" },
      { "name": "MOSI", "wave": "z.3.3.z....", "data": ["CMD 0x9F", "ADDR"] },
      { "name": "MISO", "wave": "z.....4.5.z", "data": ["MFR 0xEF", "DEV 0x40"] }
    ],
    {},
    { "name": "IRQ", "wave": "0.........1" }
  ],
  "foot": { "text": "Clock Cycle (25 MHz)", "tock": 0 }
}
```
````

---

## 2. Interactive CSV Time-Series Telemetry Viewer

### 2.1 Supported Formats
The `CsvTelemetryViewer` component (`client/src/components/Artifacts/CsvTelemetryViewer.tsx`) enhances CSV previews across:
- **Code Interpreter / Sandbox `.csv` Outputs**: Automatically detected in the Artifacts side panel (`isCsvArtifact`) whether stored as raw CSV or HTML table preview.
- **Model-Authored CSV Artifacts**: `:::artifact{type="text/csv" title="Power Rail Telemetry"}`
- **Inline CSV File Attachments**: `.csv` text attachments in chat messages.

### 2.2 Features & Interactive Controls
- **Chart / Table View Toggle**: Switch instantaneously between the **Time-Series Chart** and the structured **Table** view.
- **Automatic Channel Detection**: Uses the first column as the X-axis (timestamp/sample index) and plots all numeric columns as multi-series lines using semantic `--series-1`..`--series-8` colors.
- **Zoom & Pan**:
  - Use the toolbar buttons (**Pan Left**, **Zoom In**, **Zoom Out**, **Reset Zoom**, **Pan Right**).
  - Scroll the mouse wheel over the chart to zoom in/out around the center sample.
  - Click and drag horizontally on the chart canvas to pan across long telemetry captures.
- **Series Filtering**: Click any series pill in the legend to mute/unmute specific telemetry channels.
- **Hover Crosshair Readout**: Inspect exact values across all active series at any sample point.

### 2.3 Sample CSV Artifact Snippet

````markdown
:::artifact{identifier="rail-telemetry" type="text/csv" title="buck_converter_startup.csv"}
```csv
time_ms,v_in_v,v_out_v,i_load_a,temp_c
0.0,12.02,0.00,0.01,24.5
0.5,11.98,1.10,0.45,24.6
1.0,11.95,2.45,1.12,24.8
1.5,11.91,3.32,1.85,25.1
2.0,11.96,3.30,1.40,25.3
2.5,11.99,3.30,1.38,25.4
3.0,12.00,3.30,1.39,25.5
```
:::
````
