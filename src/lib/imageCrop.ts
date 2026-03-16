import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err),
    );
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Converts a crop rectangle drawn on a "contain"-rendered canvas into source image pixels
 * and writes a cropped file to cache.
 */
export async function cropImageFromCanvasBox(
  imageUri: string,
  canvasSize: { width: number; height: number },
  box: { left: number; top: number; right: number; bottom: number },
): Promise<string> {
  const src = await getImageSize(imageUri);

  const scale = Math.min(canvasSize.width / src.width, canvasSize.height / src.height);
  const renderWidth = src.width * scale;
  const renderHeight = src.height * scale;
  const offsetX = (canvasSize.width - renderWidth) / 2;
  const offsetY = (canvasSize.height - renderHeight) / 2;

  const x = clamp((box.left - offsetX) / scale, 0, src.width - 1);
  const y = clamp((box.top - offsetY) / scale, 0, src.height - 1);
  const right = clamp((box.right - offsetX) / scale, x + 1, src.width);
  const bottom = clamp((box.bottom - offsetY) / scale, y + 1, src.height);

  const crop = {
    originX: Math.round(x),
    originY: Math.round(y),
    width: Math.max(1, Math.round(right - x)),
    height: Math.max(1, Math.round(bottom - y)),
  };

  const result = await manipulateAsync(
    imageUri,
    [{ crop }],
    { compress: 0.95, format: SaveFormat.JPEG },
  );

  return result.uri;
}
