import Point from '@mapbox/point-geometry';
import {fromVectorTileJs} from '@maplibre/vt-pbf';
import {EXTENT} from '../data/extent.ts';
import {extend, JSON_PREFIX} from '../util/util.ts';
import {WorkerTile} from './worker_tile.ts';

import type {WorkerTileState} from './worker_tile_state.ts';
import type {VectorTileFeatureLike, VectorTileLayerLike, VectorTileLike} from '@maplibre/vt-pbf';
import type {GeoJSONVTOptions} from '@maplibre/geojson-vt';
import type {IActor} from '../util/actor.ts';
import type {StyleLayerIndex} from '../style/style_layer_index.ts';
import type {WorkerTileParameters, WorkerTileResult} from './worker_source.ts';
import type {CombinableWorkerSource, VectorTileData} from './combinable_worker_source.ts';

/**
 * A source's definition as its worker source builds itself from.
 */
export type CombinatorDefinition =
    | {type: 'geojson-layers'; data: Record<string, GeoJSON.GeoJSON>; geojsonVtOptions: GeoJSONVTOptions};

/**
 * Parameters to give a source's worker source its definition.
 */
export type SetCombinatorDefinitionParameters = {
    type: string;
    source: string;
    definition: CombinatorDefinition;
};

/**
 * Parameters to load a tile of a source with a definition.
 */
export type CombinatorTileParameters = WorkerTileParameters;

/**
 * A layer of a combined tile: features from any number of tiles, all at {@link EXTENT}.
 */
class CombinedLayer implements VectorTileLayerLike {
    version = 2;
    extent = EXTENT;
    name: string;
    features: VectorTileFeatureLike[];

    constructor(name: string, features: VectorTileFeatureLike[]) {
        this.name = name;
        this.features = features;
    }

    get length(): number {
        return this.features.length;
    }

    feature(i: number): VectorTileFeatureLike {
        return this.features[i];
    }
}

/**
 * A layer's features, at {@link EXTENT}, the extent a combined tile is encoded at.
 */
export function featuresOf(layer: VectorTileLayerLike): VectorTileFeatureLike[] {
    const features: VectorTileFeatureLike[] = [];
    for (let i = 0; i < layer.length; i++) {
        features.push(atExtent(layer.feature(i)));
    }
    return features;
}

/**
 * A feature with its geometry scaled to {@link EXTENT}, as the layers of an encoded tile have one
 * extent for all their features.
 */
function atExtent(feature: VectorTileFeatureLike): VectorTileFeatureLike {
    if (feature.extent === EXTENT) return feature;
    const scale = EXTENT / feature.extent;
    return {
        type: feature.type,
        id: feature.id,
        properties: feature.properties,
        extent: EXTENT,
        loadGeometry: () => feature.loadGeometry().map(ring => ring.map(point => new Point(Math.round(point.x * scale), Math.round(point.y * scale)))),
    };
}

/**
 * A combined tile's data, from its layers' features, or null if it has none.
 */
export function combined(layers: Map<string, VectorTileFeatureLike[]>): VectorTileData | null {
    const tile: VectorTileLike = {layers: {}};
    for (const [name, features] of layers) {
        if (features.length > 0) tile.layers[name] = new CombinedLayer(name, features);
    }
    return Object.keys(tile.layers).length > 0 ? {vectorTile: tile} : null;
}

/**
 * What the tile lifecycle functions of this module need of a source's worker source.
 */
export type CombinatorWorkerSourceState = CombinableWorkerSource & {
    actor: IActor;
    layerIndex: StyleLayerIndex;
    availableImages: string[];
    tileState: WorkerTileState;
};

/**
 * Loads a tile of a source's worker source: evaluates the source's `loadVectorTile`, and parses
 * the result. The result goes to the main thread encoded as MVT.
 */
export async function loadCombinedWorkerTile(source: CombinatorWorkerSourceState, params: CombinatorTileParameters): Promise<WorkerTileResult | null> {
    const {uid} = params;
    const workerTile = new WorkerTile(params);
    source.tileState.startLoading(uid, workerTile);
    try {
        const tileData = source.loadVectorTile(params);
        source.tileState.finishLoading(uid);
        if (!tileData) return null;

        workerTile.vectorTile = tileData.vectorTile;
        source.tileState.markLoaded(uid, workerTile);
        source.tileState.setParsing(uid, {rawData: tileData.rawData ?? fromVectorTileJs(tileData.vectorTile, JSON_PREFIX).buffer});
        return await parseCombinedWorkerTile(source, workerTile, params);
    } catch (err) {
        source.tileState.finishLoading(uid);
        source.tileState.markLoaded(uid, workerTile);
        throw err;
    }
}

async function parseCombinedWorkerTile(source: CombinatorWorkerSourceState, workerTile: WorkerTile, params: WorkerTileParameters): Promise<WorkerTileResult> {
    const parseState = source.tileState.getParsing(workerTile.uid);
    const {layerIndex, availableImages, actor} = source;
    let result = await workerTile.parse(workerTile.vectorTile, layerIndex, availableImages, actor, params.subdivisionGranularity);
    if (parseState) {
        result = extend({rawTileData: parseState.rawData.slice(0), encoding: 'mvt'}, result);
        source.tileState.removeParsing(workerTile.uid);
    }
    return result;
}

/**
 * Parses a loaded tile of a source's worker source again, and loads one that is not
 * loaded, such as after the source's definition has changed.
 */
export async function reloadCombinedWorkerTile(source: CombinatorWorkerSourceState, params: CombinatorTileParameters): Promise<WorkerTileResult> {
    const workerTile = source.tileState.getLoaded(params.uid);
    if (!workerTile) return loadCombinedWorkerTile(source, params);
    if (!workerTile.vectorTile) return;
    workerTile.showCollisionBoxes = params.showCollisionBoxes;
    return parseCombinedWorkerTile(source, workerTile, params);
}
