/// <reference path="../../_references.d.ts" />
import Iridium = require('../../index');
import Bluebird = require('bluebird');

export = NoOpCache;

class NoOpCache implements Iridium.Cache {
    set<T>(key: string, object: T): Bluebird<T> {
        return Bluebird.resolve(object);
    }

    get<T>(key: string): Bluebird<void> {
        return Bluebird.resolve();
    }

    clear(key: string): Bluebird<boolean> {
        return Bluebird.resolve(false);
    }
}