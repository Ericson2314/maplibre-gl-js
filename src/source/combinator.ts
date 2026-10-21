import {ErrorEvent, type Evented} from '../util/evented.ts';
import {MapSourceDataEvent, type SourceEventType} from '../ui/events.ts';
import {ensureError} from '../util/util.ts';
import {EXTENT} from '../data/extent.ts';
import {isAbortError} from '../util/abort_error.ts';
import {MessageType} from '../util/actor_messages.ts';

import type {Source} from './source.ts';
import type {Map} from '../ui/map.ts';
import type {Tile} from '../tile/tile.ts';
import type {Actor} from '../util/actor.ts';
import type {PromoteIdSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {CombinatorDefinition, CombinatorTileParameters} from './combinator_worker.ts';
import type {GeoJSONLayersSourceSpecification} from './geojson_layers_source.ts';

/**
 * The specification of a source whose worker source builds itself from a definition.
 */
export type CombinatorSourceSpecification = GeoJSONLayersSourceSpecification;

/** The maximum zoom GeoJSON is tiled at when nothing says otherwise, as for a `geojson` source. */
export const DEFAULT_GEOJSON_MAXZOOM = 18;

/**
 * What the functions of this module share of the sources whose tiles are computed by their worker
 * source from a definition.
 */
export type CombinatorSourceLike = Source & Evented<SourceEventType> & {
    promoteId: PromoteIdSpecification;
    map: Map;
    actorPromise: Promise<Actor>;
    _definition: CombinatorDefinition;
    _loaded: boolean;
};

/**
 * The definition a source's worker source evaluates.
 */
export function toDefinition(specification: GeoJSONLayersSourceSpecification, tileSize: number): CombinatorDefinition {
    return {
        type: 'geojson-layers',
        data: specification.data,
        geojsonVtOptions: {
            buffer: (specification.buffer ?? 128) * EXTENT / tileSize,
            tolerance: (specification.tolerance ?? 0.375) * EXTENT / tileSize,
            extent: EXTENT,
            maxZoom: specification.maxzoom ?? DEFAULT_GEOJSON_MAXZOOM,
        },
    };
}

/**
 * Gives a source's worker source its definition.
 */
export async function loadCombinator(source: CombinatorSourceLike): Promise<void> {
    source._loaded = false;
    source.fire(new MapSourceDataEvent('dataloading'));
    try {
        await (await source.actorPromise).sendAsync({type: MessageType.setCombinatorDefinition, data: {type: source.type, source: source.id, definition: source._definition}});
        source._loaded = true;
        source.fire(new MapSourceDataEvent('data', {sourceDataType: 'metadata'}));
        source.fire(new MapSourceDataEvent('data', {sourceDataType: 'content'}));
    } catch (err) {
        source._loaded = true;
        if (!isAbortError(err)) source.fire(new ErrorEvent(ensureError(err)));
    }
}

/**
 * Has a source's worker source removed.
 */
export function removeCombinator(source: CombinatorSourceLike): void {
    source.actorPromise.then(actor => actor.sendAsync({type: MessageType.removeSource, data: {type: source.type, source: source.id}}));
}

/**
 * Has a source's worker source load a tile.
 */
export async function loadCombinedTile(source: CombinatorSourceLike, tile: Tile): Promise<void> {
    const message = !tile.actor ? MessageType.loadTile : MessageType.reloadTile;
    tile.actor = await source.actorPromise;
    const {map} = source;
    const params: CombinatorTileParameters = {
        type: source.type,
        uid: tile.uid,
        tileID: tile.tileID,
        zoom: tile.tileID.overscaledZ,
        maxZoom: source.maxzoom,
        tileSize: source.tileSize,
        source: source.id,
        pixelRatio: map.getPixelRatio(),
        showCollisionBoxes: map.showCollisionBoxes,
        promoteId: source.promoteId,
        subdivisionGranularity: map.style.projection.subdivisionGranularity,
    };

    tile.abortController = new AbortController();
    try {
        const data = await tile.actor.sendAsync({type: message, data: params}, tile.abortController);
        delete tile.abortController;
        tile.unloadVectorData();
        if (!tile.aborted) {
            tile.loadVectorData(data, map.style, message === MessageType.reloadTile);
        }
    } catch (err) {
        delete tile.abortController;
        if (tile.aborted || isAbortError(err)) return;
        throw err;
    }
}

export async function abortCombinedTile(tile: Tile): Promise<void> {
    tile.abortController?.abort();
    delete tile.abortController;
    tile.aborted = true;
}

export async function unloadCombinedTile(source: CombinatorSourceLike, tile: Tile): Promise<void> {
    tile.unloadVectorData();
    await (await source.actorPromise).sendAsync({type: MessageType.removeTile, data: {uid: tile.uid, type: source.type, source: source.id}});
}
