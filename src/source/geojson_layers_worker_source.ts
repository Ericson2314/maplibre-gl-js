import {GeoJSONWorkerSource} from './geojson_worker_source.ts';
import {combined, featuresOf, loadCombinedWorkerTile, reloadCombinedWorkerTile} from './combinator_worker.ts';
import {WorkerTileState} from './worker_tile_state.ts';

import type {VectorTileFeatureLike} from '@maplibre/vt-pbf';
import type {IActor} from '../util/actor.ts';
import type {StyleLayerIndex} from '../style/style_layer_index.ts';
import type {TileParameters, WorkerTileResult} from './worker_source.ts';
import type {CombinableWorkerSource, VectorTileData} from './combinable_worker_source.ts';
import type {CombinatorTileParameters, SetCombinatorDefinitionParameters} from './combinator_worker.ts';

/**
 * The {@link WorkerSource} implementation that supports the `geojson-layers` source type, GeoJSON by
 * layer: each layer's GeoJSON is indexed by a {@link GeoJSONWorkerSource} of its own, and a tile
 * has a layer for each, holding that layer's features of the tile.
 */
export class GeoJSONLayersWorkerSource implements CombinableWorkerSource {
    actor: IActor;
    layerIndex: StyleLayerIndex;
    availableImages: string[];
    tileState: WorkerTileState;
    layers: Map<string, GeoJSONWorkerSource>;

    constructor(actor: IActor, layerIndex: StyleLayerIndex, availableImages: string[]) {
        this.actor = actor;
        this.layerIndex = layerIndex;
        this.availableImages = availableImages;
        this.tileState = new WorkerTileState();
        this.layers = new Map();
    }

    /**
     * Indexes each layer's GeoJSON.
     */
    async setDefinition({source, definition}: SetCombinatorDefinitionParameters): Promise<void> {
        if (definition.type !== 'geojson-layers') throw new Error(`sources.${source}: not a \`geojson-layers\` definition`);
        const layers = new Map<string, GeoJSONWorkerSource>();
        for (const [name, data] of Object.entries(definition.data)) {
            const workerSource = new GeoJSONWorkerSource(this.actor, this.layerIndex, this.availableImages);
            await workerSource.loadData({type: 'geojson', source, data, geojsonVtOptions: {...definition.geojsonVtOptions}});
            layers.set(name, workerSource);
        }
        this.layers = layers;
        this.tileState.clearLoaded();
    }

    /**
     * Implements {@link CombinableWorkerSource.loadVectorTile}.
     */
    loadVectorTile(params: CombinatorTileParameters): VectorTileData | null {
        const layers = new Map<string, VectorTileFeatureLike[]>();
        for (const [name, workerSource] of this.layers) {
            const tileData = workerSource.loadVectorTile(params);
            if (!tileData) continue;
            layers.set(name, Object.values(tileData.vectorTile.layers).flatMap(featuresOf));
        }
        return combined(layers);
    }

    loadTile(params: CombinatorTileParameters): Promise<WorkerTileResult | null> {
        return loadCombinedWorkerTile(this, params);
    }

    reloadTile(params: CombinatorTileParameters): Promise<WorkerTileResult> {
        return reloadCombinedWorkerTile(this, params);
    }

    async abortTile(params: TileParameters): Promise<void> {
        this.tileState.abort(params.uid);
    }

    async removeTile(params: TileParameters): Promise<void> {
        this.tileState.removeLoaded(params.uid);
    }
}
