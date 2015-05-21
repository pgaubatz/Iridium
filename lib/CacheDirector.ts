/// <reference path="../_references.d.ts" />
export = CacheDirector;

interface CacheDirector {
    valid<T>(object: T): boolean;
    buildKey<T>(object: T): string;

    validQuery(conditions: any): boolean;
    buildQueryKey(conditions: any): string;
}