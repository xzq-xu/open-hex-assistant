# PaddleOCR ONNX Models

Run this from the project root:

```bash
npm run ocr:models
```

It writes the local recognition model and dictionary here:

```text
models/paddleocr/ch_PP-OCRv4_rec_infer.onnx
models/paddleocr/ppocr_keys_v1.txt
```

The ONNX file is ignored by git and is verified by SHA256 after download. If you do not want to trust the preconverted ONNX mirror, run with `PREPARE_PADDLEOCR_CONVERT=1` to download PaddleOCR's official inference tarball and convert it locally with `uv`.

The runtime only needs the recognition model because the three augment title areas are cropped by fixed ROI. This is faster than running a full text detector on every frame.

On Windows, ONNX Runtime Node uses DirectML (`dml`) for GPU acceleration, which covers both NVIDIA and AMD GPUs through DirectX 12.

If your exported model uses a different input width or height, update `runtime/ocr-config.json`.
