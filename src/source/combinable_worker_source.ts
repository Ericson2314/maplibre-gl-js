import type {VectorTileLike} from '@maplibre/vt-pbf';
import type {WorkerSource, WorkerTileParameters} from './worker_source.ts';

/**
 * A tile's data before it is parsed: decoded, and also encoded, as fetched or computed, when the
 * source has it so.
 */
export type VectorTileData = {
    vectorTile: VectorTileLike;
    rawData?: ArrayBufferLike;
};

/**
 * A {@link WorkerSource} whose tiles are vector data, which it can give before parsing them,
 * synchronously, from data at hand: a source that fetches its tiles is handed the fetched data.
 */
export interface CombinableWorkerSource extends WorkerSource {
    /**
     * A tile's data before it is parsed, or null for a tile without data.
     */
    loadVectorTile(params: WorkerTileParameters, rawData?: ArrayBuffer): VectorTileData | null;
}
