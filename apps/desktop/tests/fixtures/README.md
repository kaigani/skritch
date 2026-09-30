# Video fixtures

`clipA` and `clipB` exercise clip insertion and timeline editing. `frames` contains 72 frames at 30 fps,
with limited-range grayscale luma `16 + 3 * frameIndex`, allowing tests to identify the displayed frame.

The H.264 `frames.mp4` fixture explicitly declares BT.709 primaries/matrix and an sRGB transfer function
in both its bitstream and container. Without these tags, macOS AVFoundation applies a default transfer
function when drawing video to a canvas, changing the gray values and falsely reporting a frame mismatch.
The tags preserve the encoded pixels, timestamps, and B-frame structure. To tag an untagged original:

```sh
ffmpeg -i frames-untagged.mp4 -c copy \
  -bsf:v 'h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=0' \
  -color_primaries bt709 -color_trc iec61966-2-1 -colorspace bt709 frames.mp4
```
