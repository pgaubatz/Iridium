/// <reference path="../_references.d.ts" />
import instance = require('./Instance');

export = Hooks;

interface Hooks<TDocument, TInstance> {
    creating? (document: TDocument): void;
    retrieved? (document: TDocument): void;
    ready? (instance: TInstance): void;
    saving? (instance: TInstance, changes: any): void;
}