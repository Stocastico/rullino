import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/core: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/core public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
    'CHAIN_VERSION', 'GpuError', 'IDENTITY_GEOMETRY', 'MAX_IMAGE_SIDE', 'MAX_LUT_SIZE', 'Pipeline',
    'ShaderCompileError', 'WebGpuUnavailableError', 'activeSteps', 'applyEdit', 'applyGeometry', 'applyGeometryCpu',
    'applyLutCpu', 'blendMasked', 'compareImages', 'createGpuContext', 'createImage', 'createLut',
    'createRasterMask', 'decodeSrgb8', 'defaultParams', 'defineFilter', 'downscale', 'downscaleCpu',
    'encodeImage', 'encodePng', 'encodeSrgb16', 'encodeSrgb8', 'exportImage', 'fillShape', 'fitWithin', 'flipGeometry',
    'fromFloat16Array', 'geometryFrame', 'histogramSrgb8', 'identityLut', 'importImage',
    'isIdentityGeometry', 'linearToOklab', 'linearToSrgb', 'luminance', 'lutFromFunction', 'magicWand',
    'maskImage', 'maskValue', 'migrateChain', 'oklabToLinear', 'paintStroke', 'parseChain', 'parseCube', 'parseHald',
    'readImage', 'readSrgb8', 'refineMask', 'releaseTexture', 'resampleRaster', 'resolveParams',
    'runChainCpu', 'runFilter', 'sampleCurve', 'sampleImage', 'serializeChain', 'srgbToLinear',
    'toFloat16Array', 'turnGeometry', 'uploadImage', 'uploadSrgb8', 'validateGeometry', 'validateMask',
    ]);
  });

  it('keeps the plumbing under the unstable "./internal" subpath', async () => {
    const internal = await import('./internal');
    expect(Object.keys(internal).sort()).toEqual([
    'CURVE_SAMPLES', 'WORKING_FORMAT', 'applyEditPixels', 'blendMask', 'colorWgsl', 'createWorkingTexture', 'curveLut',
    'curveSamplerWgsl', 'curveSamplersWgsl', 'effectiveParams', 'encodeSamples', 'encodeToTexture', 'exportSamples',
    'float16ToFloat32', 'float32ToFloat16', 'fusedShader', 'imageSamplerWgsl', 'imageTexture',
    'lutSamplerWgsl', 'lutTexture', 'namespaceWgsl', 'packParams', 'paramsLayout', 'paramsStructWgsl',
    'passShader', 'planBands', 'planSegments', 'poolStats', 'renderMask', 'reportGpuError', 'runChainBand', 'runChainBandRows', 'runChainBands', 'runFused',
    'runMultipass', 'runPointwise', 'runStepCpu', 'sampleCurveLut', 'scaleParams', 'stepReach', 'toGpuError', 'validateSchema',
    ]);
    const publicNames = new Set(Object.keys(api));
    for (const name of Object.keys(internal)) expect(publicNames.has(name), `${name} is public and internal`).toBe(false);
  });
});
