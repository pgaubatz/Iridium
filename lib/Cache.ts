/// <reference path="../_references.d.ts" />
import Bluebird = require('bluebird');

export = Cache;

interface Cache {
    set<T>(key: string, value: T): void;
    get<T>(key: string): Bluebird<T>;
    clear(key: string): void
}