import {describe, test, expect} from 'vitest';
import {PbfReader} from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {GeoJSONLayersWorkerSource} from './geojson_layers_worker_source.ts';
import {StyleLayerIndex} from '../style/style_layer_index.ts';
import {OverscaledTileID} from '../tile/tile_id.ts';
import {SubdivisionGranularitySetting} from '../render/subdivision_granularity_settings.ts';
import {EXTENT} from '../data/extent.ts';
import {createFakeActor} from '../util/test/util.ts';

import type {VectorTileLayerLike} from '@maplibre/vt-pbf';
import type {WorkerTileWithData} from './worker_source.ts';
import type {VectorTileData} from './combinable_worker_source.ts';
import type {CombinatorDefinition, CombinatorTileParameters} from './combinator_worker.ts';

describe('combinator worker sources', () => {
    test('geojson-layers gives each member of its data a layer of its own', async () => {
        const source = new GeoJSONLayersWorkerSource(createFakeActor(), new StyleLayerIndex(), []);
        await source.setDefinition({type: 'geojson-layers', source: 'overlay', definition: geojsonLayers({
            tracks: [lineFeature(1), lineFeature(2)],
            stations: [lineFeature(3)],
        })});

        const tile = source.loadVectorTile(tileParameters());

        expect(Object.keys(tile.vectorTile.layers).sort()).toEqual(['stations', 'tracks']);
        expect(ids(layerOf(tile, 'tracks'))).toEqual([1, 2]);
        expect(ids(layerOf(tile, 'stations'))).toEqual([3]);
    });

    test('loadTile parses the tile and returns it encoded', async () => {
        const layerIndex = new StyleLayerIndex([{id: 'tracks', type: 'line', source: 'overlay', 'source-layer': 'tracks'}]);
        const source = new GeoJSONLayersWorkerSource(createFakeActor(), layerIndex, []);
        await source.setDefinition({type: 'geojson-layers', source: 'overlay', definition: geojsonLayers({
            tracks: [lineFeature(1), lineFeature(2)],
        })});

        const result = await source.loadTile(tileParameters()) as WorkerTileWithData;

        expect(result.buckets.map(bucket => bucket.layerIds)).toEqual([['tracks']]);
        const tracks = new VectorTile(new PbfReader(result.rawTileData)).layers.tracks;
        expect(tracks).toHaveLength(2);
        expect(tracks.extent).toBe(EXTENT);
    });
});

function geojsonLayers(features: Record<string, GeoJSON.Feature[]>): CombinatorDefinition {
    const data: Record<string, GeoJSON.FeatureCollection> = {};
    for (const [name, layerFeatures] of Object.entries(features)) {
        data[name] = {type: 'FeatureCollection', features: layerFeatures};
    }
    return {type: 'geojson-layers', data, geojsonVtOptions: {extent: EXTENT, maxZoom: 14}};
}

function lineFeature(id: number): GeoJSON.Feature {
    return {type: 'Feature', id, properties: {}, geometry: {type: 'LineString', coordinates: [[-10, 10], [10, -10]]}};
}

function tileParameters(): CombinatorTileParameters {
    return {
        type: 'geojson-layers',
        source: 'overlay',
        uid: 0,
        tileID: new OverscaledTileID(0, 0, 0, 0, 0),
        zoom: 0,
        maxZoom: 14,
        tileSize: 512,
        promoteId: null,
        pixelRatio: 1,
        showCollisionBoxes: false,
        subdivisionGranularity: SubdivisionGranularitySetting.noSubdivision,
    };
}

function ids(layer: VectorTileLayerLike): number[] {
    return Array.from({length: layer.length}, (_, i) => layer.feature(i).id);
}

function layerOf(tileData: VectorTileData, name: string): VectorTileLayerLike {
    return tileData.vectorTile.layers[name];
}
