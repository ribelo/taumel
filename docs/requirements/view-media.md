---
kind: requirement
tags: [view-media, images, tools]
depends_on: ["[[docs/requirements/tool-gateway]]", "[[docs/requirements/tool-rendering]]"]
---
# View media

## Intent

`view_media` lets the model visually inspect local image files from the current
workspace or an absolute path. Version 1 is intentionally image-only: PNG, JPEG,
GIF, and WebP are accepted, while audio and video remain out of scope. The tool
uses the current main model's multimodal input path only; it does not dispatch to
a fallback vision model. Taumel owns path handling and image preparation, with
TypeScript kept to the tool bridge, schema validation, and model capability gate.
Pi remains responsible for global image-blocking policy.

## Requirements

### Contract and scope

- The system shall expose a model-callable tool named `view_media` with one required `path` string parameter and no additional parameters. ^viewmedia-q7m4
- The system shall treat `view_media` as a whole-image read and shall not expose crop, region, page, frame, quality, dimension, or payload-budget parameters. ^viewmedia-q3r7
- The system shall classify `view_media` as a pure read-only tool in the tool gateway. ^viewmedia-p2x8
- The system shall resolve relative `view_media` paths against the session working directory using the same path-resolution semantics as `read`. ^viewmedia-r9k1
- The system shall accept absolute local filesystem paths for `view_media` without resolving them against the session working directory. ^viewmedia-t6b0
- The system shall accept only local filesystem paths as `view_media` input. ^viewmedia-w1x9
- The system shall accept PNG, JPEG, GIF, and WebP image files as the supported v1 media formats. ^viewmedia-f6t3
- The system shall keep audio and video media outside `view_media` v1. ^viewmedia-v8c2

### Model capability

- If the current model does not advertise image input, then the system shall reject `view_media` before reading the requested path with the message `Current model does not support image input`. ^viewmedia-n5h7
- The system shall use only the current main model for `view_media` image input and shall not invoke a fallback vision model. ^viewmedia-z3d6
- The system shall rely on Pi's global image-blocking policy and shall not duplicate Pi's block-images setting parser inside Taumel. ^viewmedia-b4w9

### Image processing and result

- The system shall enforce fixed pre-decode safety ceilings of 64 MiB for the source file and 64 megapixels for the declared image dimensions, with megapixels measured as declared width multiplied by declared height. ^viewmedia-s4f8
- If an image exceeds either pre-decode safety ceiling, then the system shall return a model-visible error without decoding it or returning an image content block. ^viewmedia-r2d5
- If the system cannot determine trustworthy positive image width and height before decoding, then it shall return a model-visible error without decoding the image or returning an image content block. ^viewmedia-u7k3
- The pre-decode safety ceilings shall not be configurable through tool parameters, settings, environment variables, profiles, or session state. ^viewmedia-c8n1
- When `view_media` reads a valid supported still image that exceeds the inline dimension or payload limits, the system shall resize the image before returning it to the model. ^viewmedia-h8s2
- The system shall preserve image aspect ratio while fitting processed images within 2048 pixels wide and 768 pixels high. ^viewmedia-j4q6
- The system shall keep the encoded inline image payload at or below 4.5 MiB of base64 text. ^viewmedia-m2v5
- The system shall apply only the per-image inline payload ceiling and shall rely on Pi for cumulative request sizing, request-wide media degradation, provider HTTP 413 recovery, and compaction behavior. ^viewmedia-b7p2
- When an animated GIF or animated WebP already satisfies the pre-decode safety ceilings, inline dimension limits, and inline payload limit, the system shall return it without decoding, resizing, re-encoding, or otherwise changing its animation. ^viewmedia-a4n6
- If an animated GIF or animated WebP would require decoding, resizing, or re-encoding to satisfy an inline limit, then the system shall return a model-visible error instead of flattening, selecting a frame, or returning a modified animation. ^viewmedia-f5w8
- If an image cannot be resized below the inline payload limit, then the system shall return a model-visible error instead of an image content block. ^viewmedia-c6a1
- When `view_media` succeeds, the system shall return one image content block with base64 data and a MIME type. ^viewmedia-k9p4
- When `view_media` succeeds, the system shall include a text summary alongside the image content block. ^viewmedia-x4d0
- If the requested path cannot be processed as a supported image file, then the system shall return a model-visible error and no image content block. ^viewmedia-y2n8

### Implementation boundary

- The system shall perform `view_media` path validation in Taumel-owned execution code. ^viewmedia-o6r3
- The system shall perform `view_media` image decoding, resizing, encoding, and animation-preserving pass-through decisions in Taumel-owned execution code. ^viewmedia-e3n9
- The system shall construct the `view_media` multimodal tool result in Taumel-owned execution code. ^viewmedia-s7v1
- The TypeScript bridge for `view_media` shall be limited to schema validation, model capability gating, and forwarding between Pi and Taumel-owned execution. ^viewmedia-a2f8
- The system shall use `@silvia-odwyer/photon-node` for `view_media` image processing. ^viewmedia-l1p7
- If image processing dependencies are added for `view_media`, then the system shall not introduce `sharp`. ^viewmedia-d9u4
- The system shall not import Pi private image-processing utilities to implement `view_media`. ^viewmedia-u5e2
- The system shall not require changes in `pi-mono` to implement `view_media`. ^viewmedia-g7b4
