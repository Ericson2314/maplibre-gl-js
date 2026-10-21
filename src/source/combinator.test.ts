import {describe, test, expect} from 'vitest';
import {MercatorProjection} from '../geo/projection/mercator_projection.ts';
import {create, type Source} from './source.ts';
import {RequestManager} from '../util/request_manager.ts';
import {getWrapDispatcher, waitForMetadataEvent} from '../util/test/util.ts';
import {type ActorMessage, MessageType} from '../util/actor_messages.ts';

import type {Map} from '../ui/map.ts';
import type {Evented} from '../util/evented.ts';
import type {CombinatorSourceSpecification} from './combinator.ts';

describe('combinator sources', () => {
    test('geojson-layers takes its zoom range from its maxzoom and gives its worker its definition', async () => {
        const messages: Array<ActorMessage<MessageType>> = [];
        const source = createSource({
            type: 'geojson-layers',
            data: {tracks: {type: 'FeatureCollection', features: []}},
            maxzoom: 16,
        }, messages);

        await waitForMetadataEvent(source);

        expect(source.minzoom).toBe(0);
        expect(source.maxzoom).toBe(16);
        const {data} = messages.find(message => message.type === MessageType.setCombinatorDefinition) as ActorMessage<MessageType.setCombinatorDefinition>;
        expect(data).toEqual({
            type: 'geojson-layers',
            source: 'id',
            definition: {type: 'geojson-layers', data: {tracks: {type: 'FeatureCollection', features: []}}, geojsonVtOptions: expect.objectContaining({maxZoom: 16})},
        });
    });
});

function createSource(options: CombinatorSourceSpecification, messages: Array<ActorMessage<MessageType>>): Source & Evented {
    const dispatcher = getWrapDispatcher()({
        sendAsync(message: ActorMessage<MessageType>) {
            messages.push(message);
            return Promise.resolve({});
        },
    });
    const source = create('id', options, dispatcher, undefined) as Source & Evented;
    source.onAdd({
        _requestManager: new RequestManager(),
        style: {projection: new MercatorProjection()},
        getPixelRatio() { return 1; },
    } as any as Map);
    return source;
}
