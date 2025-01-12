﻿/// <reference path="../_references.d.ts" />
import Core from './Core';
import Model from './Model';
import {Plugin} from './Plugins';
import {CacheDirector} from './CacheDirector';
import * as General from './General';
import * as ModelInterfaces from './ModelInterfaces';
import * as Index from './Index';
import {Schema} from './Schema';

import _ = require('lodash');
import MongoDB = require('mongodb');
import Bluebird = require('bluebird');
import skmatc = require('skmatc');

export default class Instance<TDocument extends { _id?: any }, TInstance> {
    /**
     * Creates a new instance which represents the given document as a type of model
     * @param {model.Model} model The model that the document represents
     * @param {TSchema} document The document which should be wrapped by this instance
     * @param {Boolean} isNew Whether the document is new (doesn't exist in the database) or not
     * @param {Boolean} isPartial Whether the document has only a subset of its fields populated
     * @description
     * This class will be subclassed automatically by Iridium to create a model specific instance
     * which takes advantage of some of v8's optimizations to boost performance significantly.
     * The instance returned by the model, and all of this instance's methods, will be of type
     * TInstance - which should represent the merger of TSchema and IInstance for best results.
     */
    constructor(model: Model<TDocument, TInstance>, document: TDocument, isNew: boolean = true, isPartial: boolean = false) {
        this._model = model;

        this._isNew = !!isNew;
        this._isPartial = isPartial;
        this._original = document;
        this._modified = _.cloneDeep<TDocument>(document);

        _.each(model.core.plugins,(plugin: Plugin) => {
            if (plugin.newInstance) plugin.newInstance(this, model);
        });
    }

    private _isNew: boolean;
    private _isPartial: boolean;
    private _model: Model<TDocument, TInstance>;
    private _original: TDocument;
    private _modified: TDocument;

    /**
     * Gets the underlying document representation of this instance
     */
    get document(): TDocument {
        return this._modified;
    }

    [name: string]: any;

    static onCreating: (document: { _id?: any }) => void;
    static onRetrieved: (document: { _id?: any }) => void;
    static onReady: (instance: Instance<{ _id?: any }, Instance<{ _id?: any }, any>>) => void;
    static onSaving: (instance: Instance<{ _id?: any }, Instance<{ _id?: any }, any>>, changes: any) => void;
    
    static collection: string;
    
    static schema: Schema = {
        _id: false
    };
    
    static validators: Skmatc.Validator[] = [
        skmatc.create(schema => schema === MongoDB.ObjectID, function(schema, data) {
            return this.assert(!data || data instanceof MongoDB.ObjectID || (data._bsontype === 'ObjectID' && data.id));
        }, { name: 'ObjectID validation' })
    ];
    
    static transforms: { [property: string]: { fromDB: (value: any) => any; toDB: (value: any) => any; } } = {
        
    };
    
    static cache: CacheDirector;
    static indexes: (Index.Index | Index.IndexSpecification)[] = [];
    static identifier: {
        apply(fromSource: any): any;
        reverse(toSource: any): any;
    };
    
    /**
     * Saves any changes to this instance, using the built in diff algorithm to write the update query.
     * @param {function(Error, IInstance)} callback A callback which is triggered when the save operation completes
     * @returns {Promise<TInstance>}
     */
    save(callback?: General.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Saves the given changes to this instance and updates the instance to match the latest database document.
     * @param {Object} changes The MongoDB changes object to be used when updating this instance
     * @param {function(Error, IInstance)} callback A callback which is triggered when the save operation completes
     * @returns {Promise<TInstance>}
     */
    save(changes: Object, callback?: General.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Saves the given changes to this instance and updates the instance to match the latest database document.
     * @param {Object} conditions The conditions under which the update will take place - these will be merged with an _id query
     * @param {Object} changes The MongoDB changes object to be used when updating this instance
     * @param {function(Error, IInstance)} callback A callback which is triggered when the save operation completes
     * @returns {Promise<TInstance>}
     */
    save(conditions: Object, changes: Object, callback?: General.Callback<TInstance>): Bluebird<TInstance>;
    save(...args: any[]): Bluebird<TInstance> {
        var callback: General.Callback<any> = null;
        var changes: any = null;
        var conditions: any = {};

        Array.prototype.slice.call(args, 0).reverse().forEach((arg) => {
            if (typeof arg == 'function') callback = arg;
            else if (typeof arg == 'object') {
                if (!changes) changes = arg;
                else conditions = arg;
            }
        });

        return Bluebird.resolve().then(() => {
            conditions = _.cloneDeep(conditions);
            _.merge(conditions, { _id: this._modified._id });
            
            if (!changes) {
                var validation = this._model.helpers.validate(this._modified);
                if (validation.failed) return Bluebird.reject(validation.error).bind(this).nodeify(callback);

                var original = _.cloneDeep(this._original);
                var modified = _.cloneDeep(this._modified);

                changes = this._model.helpers.diff(original, modified);
            }

            if (!_.keys(changes).length) return null;

            return changes;
        }).then((changes) => {
            if (!changes && !this._isNew) return changes;
            return this._model.handlers.savingDocument(<TInstance><any>this, changes).then(() => changes);
        }).then((changes) => {
            if (!changes && !this._isNew) return false;

            if (this._isNew) {
                return new Bluebird<boolean>((resolve, reject) => {
                    this._model.collection.insertOne(this._modified, { w: 'majority' }, (err, doc) => {
                        if (err) return reject(err);
                        return resolve(<any>!!doc);
                    });
                });
            } else {
                return new Bluebird<boolean>((resolve: (changed: boolean) => void, reject) => {
                    this._model.collection.updateOne(conditions, changes, { w: 'majority' }, (err: Error, changed: boolean) => {
                        if (err) return reject(err);
                        return resolve(changed);
                    });
                });
            }
        }).then((changed: boolean) => {
            conditions = { _id: this._modified._id };
            if (!changed) return this._modified;

            return new Bluebird<TDocument>((resolve, reject) => {
                this._model.collection.findOne(conditions, (err: Error, latest) => {
                    if (err) return reject(err);
                    return resolve(latest);
                });
            });
        }).then((latest: TDocument) => {
            if(!latest) {
                this._isNew = true;
                this._original = _.cloneDeep(this._modified);
                return Bluebird.resolve(<TInstance><any>this);
            }
            
            return this._model.handlers.documentReceived(conditions, latest, (value) => {
                this._isPartial = false;
                this._isNew = false;
                this._modified = value;
                this._original = _.cloneDeep(value);
                return <TInstance><any>this;
            });
        }).nodeify(callback);
    }

    /**
     * Updates this instance to match the latest document available in the backing collection
     * @param {function(Error, IInstance)} callback A callback which is triggered when the update completes
     * @returns {Promise<TInstance>}
     */
    update(callback?: General.Callback<TInstance>): Bluebird<TInstance> {
        return this.refresh(callback);
    }

    /**
     * Updates this instance to match the latest document available in the backing collection
     * @param {function(Error, IInstance)} callback A callback which is triggered when the update completes
     * @returns {Promise<TInstance>}
     */
    refresh(callback?: General.Callback<TInstance>): Bluebird<TInstance> {
        var conditions = { _id: this._original._id };

        return Bluebird.resolve().then(() => {
            return new Bluebird<TDocument>((resolve, reject) => {
                this._model.collection.findOne(conditions,(err: Error, doc: any) => {
                    if (err) return reject(err);
                    return resolve(doc);
                });
            });
        }).then((newDocument) => {
            if (!newDocument) {
                this._isPartial = true;
                this._isNew = true;
                this._original = _.cloneDeep<TDocument>(this._modified);
                return <Bluebird<TInstance>><any>this;
            }

            return this._model.handlers.documentReceived(conditions, newDocument, (doc) => {
                this._isNew = false;
                this._isPartial = false;
                this._original = doc;
                this._modified = _.cloneDeep<TDocument>(doc);

                return <TInstance><any>this;
            });
        }).nodeify(callback);
    }

    /**
     * Removes this instance's document from the backing collection
     * @param {function(Error, IInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise<TInstance>}
     */
    delete(callback?: General.Callback<TInstance>): Bluebird<TInstance> {
        return this.remove(callback);
    }

    /**
     * Removes this instance's document from the backing collection
     * @param {function(Error, IInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise<TInstance>}
     */
    remove(callback?: General.Callback<TInstance>): Bluebird<TInstance> {
        var conditions = { _id: this._original._id };

        return Bluebird.resolve().then(() => {
            if (this._isNew) return 0;
            return new Bluebird<number>((resolve, reject) => {
                this._model.collection.remove(conditions, { w: 'majority' },(err: Error, removed?: any) => {
                    if (err) return reject(err);
                    return resolve(removed);
                });
            });
        }).then((removed) => {
            if (removed) return this._model.cache.clear(conditions);
            return false;
        }).then(() => {
            this._isNew = true;
            return <TInstance><any>this;
        }).nodeify(callback);
    }

    /**
     * Retrieves the first element in an enumerable collection which matches the predicate
     * @param {any[]} collection The collection from which to retrieve the element
     * @param {function(any, Number): Boolean} predicate The function which determines whether to select an element
     * @returns {any}
     */
    first<T>(collection: T[], predicate: General.Predicate<T>): T;
    /**
     * Retrieves the first element in an enumerable collection which matches the predicate
     * @param {Object} collection The collection from which to retrieve the element
     * @param {function(any, String): Boolean} predicate The function which determines whether to select an element
     * @returns {any}
     */
    first<T>(collection: { [key: string]: T }, predicate: General.Predicate<T>): T;
    first<T>(collection: T[]| { [key: string]: T }, predicate: General.Predicate<T>): T {
        var result = null;

        _.each(collection,(value: T, key) => {
            if (predicate.call(this, value, key)) {
                result = value;
                return false;
            }
        });

        return result;
    }

    /**
     * Retrieves a number of elements from an enumerable collection which match the predicate
     * @param {any[]} collection The collection from which elements will be plucked
     * @param {function(any, Number): Boolean} predicate The function which determines the elements to be plucked
     * @returns {any[]}
     */
    select<T>(collection: T[], predicate: General.Predicate<T>): T[];
    /**
     * Retrieves a number of elements from an enumerable collection which match the predicate
     * @param {Object} collection The collection from which elements will be plucked
     * @param {function(any, String): Boolean} predicate The function which determines the elements to be plucked
     * @returns {Object}
     */
    select<T>(collection: { [key: string]: T }, predicate: General.Predicate<T>): { [key: string]: T };
    select<T>(collection: T[]| { [key: string]: T }, predicate: General.Predicate<T>): any {
        var isArray = Array.isArray(collection);
        var results: any = isArray ? [] : {};

        _.each(collection,(value: T, key) => {
            if (predicate.call(this, value, key)) {
                if (isArray) results.push(value);
                else results[key] = value;
            }
        });

        return results;
    }

    /**
     * Gets the JSON representation of this instance
     * @returns {TDocument}
     */
    toJSON(): any {
        return this.document;
    }

    /**
     * Gets a string representation of this instance
     * @returns {String}
     */
    toString(): string {
        return JSON.stringify(this.document, null, 2);
    }
}