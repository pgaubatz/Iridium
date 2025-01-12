/// <reference path="../../_references.d.ts" />
import {CacheDirector} from '../CacheDirector';
import MongoDB = require('mongodb');

export default class IDCacheDirector implements CacheDirector{
    valid(object: { _id: any }) {
        return !!object._id;
    }

    buildKey(object: { _id: any }) {
        if (object._id._bsontype == 'ObjectID')
            return new MongoDB.ObjectID(object._id.id).toHexString();
        return object._id;
    }

    validQuery(conditions) {
        return !!conditions._id;
    }

    buildQueryKey(conditions) {
        if (conditions._id._bsontype == 'ObjectID')
            return new MongoDB.ObjectID(conditions._id.id).toHexString();
        return conditions._id;
    }
}