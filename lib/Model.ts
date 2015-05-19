/// <reference path="../_references.d.ts" />
import MongoDB = require('mongodb');
import Skmatc = require('skmatc');
import Concoction = require('concoction');
import Bluebird = require('bluebird');
import util = require('util');
import _ = require('lodash');

import Iridium = require('./Core');
import instance = require('./Instance');
import ISchema = require('./Schema');
import hooks = require('./Hooks');
import IPlugin = require('./Plugins');
import cache = require('./Cache');
import CacheDirector = require('./CacheDirector');
import general = require('./General');
import Cursor = require('./Cursor');
import Index = require('./Index');
import ModelOptions = require('./ModelOptions');

import noOpCache = require('./caches/NoOpCache');
import memoryCache = require('./caches/MemoryCache');
import idCacheController = require('./cacheControllers/IDDirector');

import Omnom = require('./utils/Omnom');
import ModelCache = require('./ModelCache');
import ModelHelpers = require('./ModelHelpers');
import ModelHandlers = require('./ModelHandlers');
import ModelInterfaces = require('./ModelInterfaces');
import ModelSpecificInstance = require('./ModelSpecificInstance');

export = Model;

class Model<TDocument extends { _id?: any }, TInstance> implements ModelInterfaces.IModel<TDocument, TInstance> {
    /**
     * Creates a new Iridium model representing a given schema and backed by a collection whose name is specified
     * @param {Iridium} core The Iridium core that this model should use for database access
     * @param {function(doc, isNew, isPartial)} instanceType The type which will be used to create new instances for retrieved documents
     * @param {String} collection The name of the collection within the database which should be used by this model
     * @param {schema} schema The schema defining the data validations to be performed on the model
     * @param {IModelOptions} options The options dictating the behaviour of the model
     * @constructs Iridium.Model
     * @memberof Iridium
     * @description
     * This class provides tools to access documents within the MongoDB database in their wrapped form. You will need to
     * provide an Iridium Core instance as well as the type wrapper, collection name and basic schema for the documents in
     * this collection before you can begin using this model.
     * 
     * @example <caption>TypeScript</caption>
     * interface UserDocument {}
     * class UserInstance extends Iridium.Instance<UserDocument, UserInstance> {}
     * var UserModel = new Iridium.Model(core, UserInstance, 'user', { _id: false });
     * 
     * @example <caption>JavaScript</caption>
     * function UserInstance() { Iridium.Instance.apply(this, arguments); }
     * require('util').inherits(UserInstance, Iridium.Instance);
     * var UserModel = new Iridium.Model(core, UserInstance, 'user', { _id: false });
     */
    constructor(core: Iridium,
        instanceType: ModelInterfaces.InstanceCreator<TDocument, TInstance> | ModelInterfaces.InstanceConstructor<TDocument, TInstance>,
        collection: string,
        schema: ISchema,
        options: ModelOptions.IModelOptions<TDocument, TInstance> = {}) {
        if (!(core instanceof Iridium)) throw new Error("You failed to provide a valid Iridium core for this model");
        if (typeof instanceType != 'function') throw new Error("You failed to provide a valid instance constructor for this model");
        if (typeof collection != 'string' || !collection) throw new Error("You failed to provide a valid collection name for this model");
        if (!_.isPlainObject(schema) || schema._id === undefined) throw new Error("You failed to provide a valid schema for this model");

        _.defaults(options, <ModelOptions.IModelOptions<TDocument, TInstance>>{
            hooks: {},
            identifier: {
                apply: function (value) {
                    return (value && value._bsontype == 'ObjectID') ? new MongoDB.ObjectID(value.id).toHexString() : value;
                },
                reverse: function (value) {
                    if (value === null || value === undefined) return undefined;
                    if (value && /^[a-f0-9]{24}$/.test(value)) return MongoDB.ObjectID.createFromHexString(value);
                    return value;
                }
            },
            cache: new idCacheController()
        });

        this._core = core;
        this._collection = collection;
        this._schema = schema;
        this._options = options;

        core.plugins.forEach((plugin: IPlugin) => {
            if (plugin.newModel) plugin.newModel(this);
        });

        this._cacheDirector = options.cache;
        this._cache = new ModelCache(this);

        if ((<Function>instanceType).prototype instanceof instance)
            this._Instance = ModelSpecificInstance(this, <ModelInterfaces.InstanceConstructor<TDocument, TInstance>>instanceType);
        else
            this._Instance = <ModelInterfaces.ModelSpecificInstanceConstructor<TDocument, TInstance>>((<Function>instanceType).bind(undefined, this));

        this._helpers = new ModelHelpers(this);
        this._handlers = new ModelHandlers(this);
    }

    private _options: ModelOptions.IModelOptions<TDocument, TInstance>;
    /**
     * Gets the options provided when instantiating this model
     * @public
     * @member {Iridium.ModelOptions} #options
     * @memberof Iridium.Model
     * @description
     * This is intended to be consumed by plugins which require any configuration
     * options. Changes made to this object after the {plugin.newModel} hook are
     * called will not have any effect on this model.
     */
    get options(): ModelOptions.IModelOptions<TDocument, TInstance> {
        return this._options;
    }

    private _helpers: ModelHelpers<TDocument, TInstance>;
    /**
     * Provides helper methods used by Iridium for common tasks
     * @member {ModelHelpers<TSchema>} #helpers
     * @memberof Iridium.Model
     */
    get helpers(): ModelHelpers<TDocument, TInstance> {
        return this._helpers;
    }

    private _handlers: ModelHandlers<TDocument, TInstance>;
    /**
     * Provides helper methods used by Iridium for hook delegation and common processes
     * @member {ModelHandlers<TSchema>} #handlers
     * @memberof Iridium.Model
     */
    get handlers(): ModelHandlers<TDocument, TInstance> {
        return this._handlers;
    }

    private _schema: ISchema;
    /**
     * Gets the ISchema dictating the data structure represented by this model
     * @public
     * @member {schema} #schema
     * @memberof Iridium.Model
     */
    get schema(): ISchema {
        return this._schema;
    }

    private _core: Iridium;
    /**
     * Gets the Iridium core that this model is associated with
     * @public
     * @member {Iridium} #core
     * @memberof Iridium.Model
     */
    get core(): Iridium {
        return this._core;
    }

    private _collection: string;
    /**
     * Gets the underlying MongoDB collection from which this model's documents are retrieved
     * @public
     * @member {Collection} #collection
     * @memberof Iridium.Model
     */
    get collection(): MongoDB.Collection {
        if (!this.core.connection) throw new Error("Iridium Core not connected to a database.");
        return this.core.connection.collection(this._collection);
    }
    
    /**
     * Gets the name of the underlying MongoDB collection from which this model's documents are retrieved
     * @public
     * @member {String} #collectionName
     * @memberof Iridium.Model
     */
    get collectionName(): string {
        return this._collection;
    }
    set collectionName(value: string) {
        this._collection = value;
    }

    private _cacheDirector: CacheDirector;
    /**
     * Gets the cache controller which dictates which queries will be cached, and under which key
     * @public
     * @member {CacheDirector} #cacheDirector
     * @memberof Iridium.Model
     */
    get cacheDirector(): CacheDirector {
        return this._cacheDirector;
    }

    private _cache: ModelCache;
    /**
     * Gets the cache responsible for storing objects for quick retrieval under certain conditions
     * @public
     * @member {ModelCache} #cache
     * @memberof Iridium.Model
     */
    get cache(): ModelCache {
        return this._cache;
    }

    private _Instance: ModelInterfaces.ModelSpecificInstanceConstructor<TDocument, TInstance>;

    /**
     * Gets the constructor responsible for creating instances for this model
     * @memberof Iridium.Model
     * @member {function} #Instance
     */
    get Instance(): ModelInterfaces.ModelSpecificInstanceConstructor<TDocument, TInstance> {
        return this._Instance;
    }
    
    /**
     * Retrieves all documents in the collection and wraps them as instances
     * @returns {Iridium.Cursor}
     * @public
     */
    find(): Cursor<TDocument, TInstance>;
    /**
     * Returns all documents in the collection which match the conditions and wraps them as instances
     * @param {Object} conditions The MongoDB query dictating which documents to return
     * @returns {Iridium.Cursor}
     * @public
     */
    find(conditions: any): Cursor<TDocument, TInstance>;
    /**
     * Returns all documents in the collection which match the conditions
     * @param {Object} conditions The MongoDB query dictating which documents to return
     * @param {Object} fields The fields to include or exclude from the document
     * @returns {Iridium.Cursor}
     * @public
     */
    find(conditions: any, fields: { [name: string]: number }): Cursor<TDocument, TInstance>;
    /**
     * Returns all documents in the collection which match the conditions
     * @param {?Object} conditions The MongoDB query dictating which documents to return
     * @param {?Object} fields The fields to include or exclude from the document
     * @returns {Iridium.Cursor}
     * @public
     */
    find(conditions?: any, fields?: any): Cursor<TDocument, TInstance> {
        conditions = conditions || {};
        fields = fields || {};

        if (!_.isPlainObject(conditions)) conditions = { _id: conditions };

        if (conditions.hasOwnProperty('_id'))
            conditions['_id'] = this.options.identifier.reverse(conditions['_id']);

        var cursor = this.collection.find(conditions, {
            fields: fields
        });

        return new Cursor<TDocument, TInstance>(this, conditions, cursor);
    }

    /**
     * Retrieves a single document from the collection and wraps it as an instance
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    get(callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection with the given ID and wraps it as an instance
     * @param {any} id The document's unique _id field value in downstream format
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    get(id: any, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection which matches the conditions
     * @param {Object} conditions The MongoDB query dictating which document to return
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    get(conditions: { [key: string]: any }, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection with the given ID and wraps it as an instance
     * @param {any} id The document's unique _id field value in downstream format
     * @param {QueryOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    get(id: any, options: ModelOptions.QueryOptions, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection which matches the conditions
     * @param {Object} conditions The MongoDB query dictating which document to return
     * @param {QueryOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    get(conditions: { [key: string]: any }, options: ModelOptions.QueryOptions, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection which matches the conditions
     * @param {?Any|Object} conditions The MongoDB query dictating which document to return
     * @param {?QueryOptions} options The options dictating how this function behaves
     * @param {?function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    get(...args: any[]): Bluebird<TInstance> {
        return this.findOne.apply(this, args);
    }

    /**
     * Retrieves a single document from the collection and wraps it as an instance
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    findOne(callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection with the given ID and wraps it as an instance
     * @param {any} id The document's unique _id field value in downstream format
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    findOne(id: any, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection which matches the conditions
     * @param {Object} conditions The MongoDB query dictating which document to return
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    findOne(conditions: { [key: string]: any }, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection with the given ID and wraps it as an instance
     * @param {any} id The document's unique _id field value in downstream format
     * @param {QueryOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    findOne(id: any, options: ModelOptions.QueryOptions, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection which matches the conditions
     * @param {Object} conditions The MongoDB query dictating which document to return
     * @param {QueryOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    findOne(conditions: { [key: string]: any }, options: ModelOptions.QueryOptions, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Retrieves a single document from the collection which matches the conditions
     * @param {?Any|Object} conditions The MongoDB query dictating which document to return
     * @param {?QueryOptions} options The options dictating how this function behaves
     * @param {?function(Error, TInstance)} callback An optional callback which will be triggered when a result is available
     * @returns {Promise}
     * @public
     */
    findOne(...args: any[]): Bluebird<TInstance> {
        var conditions: { [key: string]: any } = null;
        var options: ModelOptions.QueryOptions = null;
        var callback: general.Callback<TInstance> = null;

        for (var argI = 0; argI < args.length; argI++) {
            if (typeof args[argI] == 'function') callback = callback || args[argI];
            else if (_.isPlainObject(args[argI])) {
                if (conditions) options = args[argI];
                else conditions = args[argI];
            }
            else conditions = { _id: args[argI] };
        }

        conditions = conditions || {};
        options = options || {};

        _.defaults(options, {
            cache: true
        });

        return Bluebird.resolve().bind(this).then(() => {
            if (conditions.hasOwnProperty('_id'))
                conditions['_id'] = this.options.identifier.reverse(conditions['_id']);

            return this._cache.get<TDocument>(conditions);
        }).then((cachedDocument: TDocument) => {
            if (cachedDocument) return cachedDocument;
            return new Bluebird<any>((resolve, reject) => {
                this.collection.findOne(conditions, <MongoDB.CollectionFindOptions>{
                    fields: options.fields,
                    skip: options.skip,
                    sort: options.sort,
                    limit: options.limit
                },(err, result) => {
                        if (err) return reject(err);
                        return resolve(result);
                    });
            });
        }).then((document: TDocument) => {
            if (!document) return null;
            return this._handlers.documentReceived(conditions, document,(document, isNew?, isPartial?) => this._helpers.wrapDocument(document, isNew, isPartial), options);
        }).nodeify(callback);
    }

    /**
     * Inserts an object into the collection after validating it against this model's schema
     * @param {Object} object The object to insert into the collection
     * @param {function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    create(objects: TDocument, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Inserts an object into the collection after validating it against this model's schema
     * @param {Object} object The object to insert into the collection
     * @param {CreateOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    create(objects: TDocument, options: ModelOptions.CreateOptions, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Inserts the objects into the collection after validating them against this model's schema
     * @param {Object[]} objects The objects to insert into the collection
     * @param {function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    create(objects: TDocument[], callback?: general.Callback<TInstance[]>): Bluebird<TInstance[]>;
    /**
     * Inserts the objects into the collection after validating them against this model's schema
     * @param {Object[]} objects The objects to insert into the collection
     * @param {CreateOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    create(objects: TDocument[], options: ModelOptions.CreateOptions, callback?: general.Callback<TInstance[]>): Bluebird<TInstance[]>;
    /**
     * Inserts the objects into the collection after validating them against this model's schema
     * @param {Object[]} objects The objects to insert into the collection
     * @param {?CreateOptions} options The options dictating how this function behaves
     * @param {?function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    create(...args: any[]): Bluebird<any> {
        return this.insert.apply(this, args);
    }

    /**
     * Inserts an object into the collection after validating it against this model's schema
     * @param {Object} object The object to insert into the collection
     * @param {function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    insert(objects: TDocument, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Inserts an object into the collection after validating it against this model's schema
     * @param {Object} object The object to insert into the collection
     * @param {CreateOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    insert(objects: TDocument, options: ModelOptions.CreateOptions, callback?: general.Callback<TInstance>): Bluebird<TInstance>;
    /**
     * Inserts the objects into the collection after validating them against this model's schema
     * @param {Object[]} objects The objects to insert into the collection
     * @param {function(Error, TInstance[])} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    insert(objects: TDocument[], callback?: general.Callback<TInstance[]>): Bluebird<TInstance[]>;
    /**
     * Inserts the objects into the collection after validating them against this model's schema
     * @param {Object[]} objects The objects to insert into the collection
     * @param {CreateOptions} options The options dictating how this function behaves
     * @param {function(Error, TInstance[])} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    insert(objects: TDocument[], options: ModelOptions.CreateOptions, callback?: general.Callback<TInstance[]>): Bluebird<TInstance[]>;
    /**
     * Inserts the objects into the collection after validating them against this model's schema
     * @param {Object[]} objects The objects to insert into the collection
     * @param {?CreateOptions} options The options dictating how this function behaves
     * @param {?function(Error, TInstance[])} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    insert(objs: TDocument | TDocument[], ...args: any[]): Bluebird<any> {
        var objects: TDocument[];
        var options: ModelOptions.CreateOptions = {};
        var callback: general.Callback<any> = null;
        if (typeof args[0] == 'function') callback = args[0];
        else {
            options = args[0];
            callback = args[1];
        }

        var returnArray: boolean = false;
        if (Array.isArray(objs))
            objects = <TDocument[]>objs;
        else
            objects = <TDocument[]>[objs];

        options = options || {};
        _.defaults(options, <ModelOptions.CreateOptions>{
            w: 'majority',
            forceServerObjectId: true
        });

        return Bluebird.resolve().then(() => {
            var queryOptions = { w: options.w, upsert: options.upsert, new: true };

            if (options.upsert) {
                var docs = this._handlers.creatingDocuments(objects);
                return docs.map((object: { _id: any; }) => {
                    return new Bluebird<any[]>((resolve, reject) => {
                        this.collection.findAndModify({ _id: object._id }, ["_id"], object, queryOptions,(err, result) => {
                            if (err) return reject(err);
                            return resolve(result);
                        });
                    });
                });
            }
            else
                return this._handlers.creatingDocuments(objects).then((objects) => {
                    return new Bluebird<any[]>((resolve, reject) => {
                        this.collection.insertMany(objects, queryOptions,(err, result) => {
                            if (err) return reject(err);
                            return resolve(result.ops);
                        });
                    });
                });
        }).map((inserted: any) => {
            return this._handlers.documentReceived(null, inserted,(document, isNew?, isPartial?) => this._helpers.wrapDocument(document, isNew, isPartial), { cache: options.cache });
        }).then((results: TInstance[]) => {
            if (Array.isArray(objs)) return results;
            return results[0];
        }).nodeify(callback);
    }

    /**
     * Updates the documents in the backing collection which match the conditions using the given update instructions
     * @param {Object} conditions The conditions which determine which documents will be updated
     * @param {Object} changes The changes to make to the documents
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    update(conditions: any, changes: any, callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Updates the documents in the backing collection which match the conditions using the given update instructions
     * @param {Object} conditions The conditions which determine which documents will be updated
     * @param {Object} changes The changes to make to the documents
     * @param {UpdateOptions} options The options which dictate how this function behaves
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    update(conditions: any, changes: any, options: ModelOptions.UpdateOptions, callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Updates the documents in the backing collection which match the conditions using the given update instructions
     * @param {Object} conditions The conditions which determine which documents will be updated
     * @param {Object} changes The changes to make to the documents
     * @param {?UpdateOptions} options The options which dictate how this function behaves
     * @param {?function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    update(conditions: any, changes: any, options?: ModelOptions.UpdateOptions, callback?: general.Callback<number>): Bluebird<number> {
        if (typeof options == 'function') {
            callback = <general.Callback<number>>options;
            options = {};
        }
        
        options = options || {};

        if (!_.isPlainObject(conditions)) conditions = {
            _id: conditions
        };

        _.defaults(options, {
            w: 'majority',
            multi: true
        });

        return Bluebird.resolve().then(() => {
            if (conditions.hasOwnProperty('_id'))
                conditions['_id'] = this.options.identifier.reverse(conditions['_id']);

            return new Bluebird<number>((resolve, reject) => {
                this.collection.updateMany(conditions, changes, options,(err, response) => {
                    if (err) return reject(err);

                    // New MongoDB 2.6+ response type
                    if (response.result && response.result.nModified !== undefined) return resolve(response.result.nModified);

                    // Legacy response type
                    return resolve(response.result.n);
                });
            })
        }).nodeify(callback);
    }

    /**
     * Counts the number of documents in the collection
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    count(callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Counts the number of documents in the collection which match the conditions provided
     * @param {Object} conditions The conditions which determine whether an object is counted or not
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    count(conditions: any, callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Counts the number of documents in the collection which match the conditions provided
     * @param {?Object} conditions The conditions which determine whether an object is counted or not
     * @param {?function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    count(conditions?: any, callback?: general.Callback<number>): Bluebird<number> {
        if (typeof conditions == 'function') {
            callback = <general.Callback<number>>conditions;
            conditions = {};
        }

        conditions = conditions || {};

        if (!_.isPlainObject(conditions)) conditions = {
            _id: conditions
        };

        return Bluebird.resolve().then(() => {
            if (conditions.hasOwnProperty('_id'))
                conditions['_id'] = this.options.identifier.reverse(conditions['_id']);

            return new Bluebird<number>((resolve, reject) => {
                this.collection.count(conditions,(err, results) => {
                    if (err) return reject(err);
                    return resolve(results);
                });
            });
        }).nodeify(callback);
    }

    /**
     * Removes all documents from the collection
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    remove(callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Removes all documents from the collection which match the conditions
     * @param {Object} conditions The conditions determining whether an object is removed or not
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    remove(conditions: any, callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Removes all documents from the collection which match the conditions
     * @param {Object} conditions The conditions determining whether an object is removed or not
     * @param {Object} options The options controlling the way in which the function behaves
     * @param {function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    remove(conditions: any, options: ModelOptions.RemoveOptions, callback?: general.Callback<number>): Bluebird<number>;
    /**
     * Removes all documents from the collection which match the conditions
     * @param {?Object} conditions The conditions determining whether an object is removed or not
     * @param {?Object} options The options controlling the way in which the function behaves
     * @param {?function(Error, Number)} callback A callback which is triggered when the operation completes
     * @returns {Promise}
     * @public
     */
    remove(conditions?: any, options?: ModelOptions.RemoveOptions, callback?: general.Callback<number>): Bluebird<number> {
        if (typeof options === 'function') {
            callback = <general.Callback<number>>options;
            options = {};
        }
        
        if(typeof conditions === 'function') {
            callback = <general.Callback<number>>conditions;
            options = {};
            conditions = {};
        }

        conditions = conditions || {};
        options = options || {};
        
        _.defaults(options, {
            w: 'majority'
        });

        if (!_.isPlainObject(conditions)) conditions = {
            _id: conditions
        };

        return Bluebird.resolve().then(() => {
            if (conditions.hasOwnProperty('_id'))
                conditions['_id'] = this.options.identifier.reverse(conditions['_id']);

            return new Bluebird<number>((resolve, reject) => {
                this.collection.remove(conditions, options,(err, response) => {
                    if (err) return reject(err);
                    return resolve(response.result.n);
                });
            });
        }).then((count) => {
            if (count === 1) this._cache.clear(conditions);
            return Bluebird.resolve(count);
        }).nodeify(callback);
    }

    /**
     * Ensures that the given index is created for the collection
     * @param {Object} specification The index specification object used by MongoDB
     * @param {function(Error, String)} callback A callback which is triggered when the operation completes
     * @returns {Promise} The name of the index
     * @public
     */
    ensureIndex(specification: Index.IndexSpecification, callback?: general.Callback<string>): Bluebird<string>;
    /**
     * Ensures that the given index is created for the collection
     * @param {Object} specification The index specification object used by MongoDB
     * @param {MongoDB.IndexOptions} options The options dictating how the index is created and behaves
     * @param {function(Error, String)} callback A callback which is triggered when the operation completes
     * @returns {Promise} The name of the index
     * @public
     */
    ensureIndex(specification: Index.IndexSpecification, options: MongoDB.IndexOptions, callback?: general.Callback<string>): Bluebird<string>;
    /**
     * Ensures that the given index is created for the collection
     * @param {Object} specification The index specification object used by MongoDB
     * @param {?MongoDB.IndexOptions} options The options dictating how the index is created and behaves
     * @param {?function(Error, String)} callback A callback which is triggered when the operation completes
     * @returns {Promise} The name of the index
     * @public
     */
    ensureIndex(specification: Index.IndexSpecification, options?: MongoDB.IndexOptions, callback?: general.Callback<string>): Bluebird<string> {
        if (typeof options == 'function') {
            callback = <general.Callback<any>>options;
            options = {};
        }

        return new Bluebird<string>((resolve, reject) => {
            this.collection.ensureIndex(specification, options,(err, name: any) => {
                if (err) return reject(err);
                return resolve(name);
            });
        }).nodeify(callback);
    }

    /**
     * Ensures that all indexes defined in the model's options are created
     * @param {function(Error, String[])} callback A callback which is triggered when the operation completes
     * @returns {Promise} The names of the indexes
     * @public
     */
    ensureIndexes(callback?: general.Callback<string[]>): Bluebird<string[]> {
        return Bluebird.resolve(this.options.indexes).map((index: Index.Index | Index.IndexSpecification) => {
            return this.ensureIndex((<Index.Index>index).spec || <Index.IndexSpecification>index,(<Index.Index>index).options || {});
        }).nodeify(callback);
    }

    /**
     * Drops the index with the specified name if it exists in the collection
     * @param {String} name The name of the index to remove
     * @param {function(Error, Boolean)} callback A callback which is triggered when the operation completes
     * @returns {Promise} Whether the index was dropped
     * @public
     */
    dropIndex(name: string, callback?: general.Callback<boolean>): Bluebird<boolean>;
    /**
     * Drops the index if it exists in the collection
     * @param {IndexSpecification} index The index to remove
     * @param {function(Error, Boolean)} callback A callback which is triggered when the operation completes
     * @returns {Promise} Whether the index was dropped
     * @public
     */
    dropIndex(index: Index.IndexSpecification, callback?: general.Callback<boolean>): Bluebird<boolean>;
    /**
     * Drops the index if it exists in the collection
     * @param {String | IndexSpecification} index The index to remove
     * @param {?function(Error, Boolean)} callback A callback which is triggered when the operation completes
     * @returns {Promise} Whether the index was dropped
     * @public
     */
    dropIndex(specification: string | Index.IndexSpecification, callback?: general.Callback<boolean>): Bluebird<boolean> {
        var index: string;

        if (typeof (specification) === 'string') index = <string>specification;
        else {
            index = _(<Index.IndexSpecification>specification).map((direction, key) => key + '_' + direction).reduce<string>((x, y) => x + '_' + y);
        }

        return new Bluebird<boolean>((resolve, reject) => {
            this.collection.dropIndex(index,(err, result: { ok: number }) => {
                if (err) return reject(err);
                return resolve(<any>!!result.ok);
            });
        }).nodeify(callback);
    }

    /**
     * Removes all indexes (except for _id) from the collection
     * @param {function(Error, Boolean)} callback A callback which is triggered when the operation completes
     * @returns {Promise} Whether the indexes were dropped
     * @public
     */
    dropIndexes(callback?: general.Callback<boolean>): Bluebird<boolean> {
        return new Bluebird<any>((resolve, reject) => {
            this.collection.dropAllIndexes((err, count) => {
                if (err) return reject(err);
                return resolve(count);
            });
        }).nodeify(callback);
    }
}

/**
 * @typedef {Object} Hooks
 * @memberof Iridium
 * @property {?function(Object)} creating - A function which will be called whenever a document is being created
 * @property {?function(Object)} retrieved - A function which will be called whenever a document is retrieved from the database
 * @property {?function(Object)} ready - A function which is called whenever a document has been wrapped by an instance
 * @property {?function(Object, Object)} saving - A function which is called whenever an instance is being saved
 */