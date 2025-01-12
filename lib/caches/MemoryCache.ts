/// <reference path="../../_references.d.ts" />
import Bluebird = require('bluebird');
import {Cache} from '../Cache';

export default class MemoryCache implements Cache {
    private cache: any = {};

    set<T>(key: string, value: T): Bluebird<T> {
        this.cache[key] = value;
        return Bluebird.resolve(value);
    }

    get<T>(key: string): Bluebird<T> {
        return Bluebird.resolve(this.cache[key]);
    }

    clear(key: string) : Bluebird<boolean> {
        var has = this.cache.hasOwnProperty(key);
        if(has) delete this.cache[key];
        return Bluebird.resolve(has);
    }
}