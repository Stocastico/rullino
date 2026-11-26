import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/core: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/core public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
    'CHAIN_VERSION', 'EDIT_VERSION', 'GpuError', 'IDENTITY_GEOMETRY', 'MAX_IMAGE_SIDE', 'MAX_LUT_SIZE', 'NODE_KINDS', 'ParseError', 'Pipeline',
    'ShaderCompileError', 'WebGpuUnavailableError', 'activeSteps', 'applyEdit', 'applyGeometry', 'applyGeometryCpu',
    'applyLutCpu', 'blendMasked', 'compareImages', 'createGpuContext', 'createImage', 'createLut',
    'createRasterMask', 'decodeSrgb8', 'defaultParams', 'defineFilter', 'downscale', 'downscaleCpu',
    'encodeImage', 'encodePng', 'encodeSrgb16', 'encodeSrgb8', 'exportImage', 'fillShape', 'fitWithin', 'flipGeometry',
    'formatCube', 'fromFloat16Array', 'geometryFrame', 'histogramSrgb8', 'identityLut', 'importImage',
    'isIdentityGeometry', 'isSrgbProfile', 'linearToOklab', 'linearToSrgb', 'luminance', 'lutFromFunction', 'magicWand',
    'maskImage', 'maskValue', 'migrateChain', 'migrateEdit', 'oklabToLinear', 'paintStroke', 'parseChain', 'parseCube', 'parseEdit', 'parseHald', 'parseIcc', 'profileImage',
    'readImage', 'readSrgb8', 'refineMask', 'releaseTexture', 'resampleRaster', 'resolveParams',
    'runChainCpu', 'runFilter', 'sampleCurve', 'sampleImage', 'serializeChain', 'srgbToLinear',
    'toFloat16Array', 'turnGeometry', 'uploadImage', 'uploadSrgb8', 'validateGeometry', 'validateMask',
    ]);
  });

  it('keeps the plumbing under the unstable "./internal" subpath', async () => {
    const internal = await import('./internal');
    expect(Object.keys(internal).sort()).toEqual([
    'CURVE_SAMPLES', 'SRGB_PRIMARIES', 'WORKING_FORMAT', 'XYZ_D50_TO_LINEAR_SRGB', 'applyEditPixels', 'bandReach', 'bindSources', 'blendMask', 'chainDocument', 'checkMixSizes', 'colorWgsl', 'createWorkingTexture', 'curveLut',
    'curveSamplerWgsl', 'curveSamplersWgsl', 'effectiveParams', 'encodeSamples', 'encodeToTexture', 'evalCurve', 'exportSamples',
    'float16ToFloat32', 'float32ToFloat16', 'fusedShader', 'imageSamplerWgsl', 'imageTexture', 'inv3',
    'lutSamplerWgsl', 'lutTexture', 'mixMask', 'mul3', 'namespaceWgsl', 'packParams', 'paramsLayout', 'paramsStructWgsl',
    'passShader', 'planBands', 'planSegments', 'planTiles', 'poolStats', 'profileToXyz', 'readTextureBytes', 'renderMask', 'reportGpuError', 'resizeSize', 'rgbToXyzD50', 'runChainBand', 'runChainBandRows', 'runChainBands', 'runChainTiled', 'runFused',
    'runGraphCpu', 'runGraphGpu', 'runMultipass', 'runPointwise', 'runStepCpu', 'sampleCurveLut', 'scaleParams', 'setPoolLimit', 'stepReach', 'sumStats', 'toGpuError', 'twoPhaseStat', 'uploadHalves', 'uploadSrgb8Rect', 'validateSchema', 'walkGraph', 'wholeFrame',
    ]);
    const publicNames = new Set(Object.keys(api));
    for (const name of Object.keys(internal)) expect(publicNames.has(name), `${name} is public and internal`).toBe(false);
  });
});
