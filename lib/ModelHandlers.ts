﻿/// <reference path="../_references.d.ts" />
import Iridium = require('./Core');
import ISchema = require('./Schema');
import MongoDB = require('mongodb');
import Model = require('./Model');
import ModelCache = require('./ModelCache');
import ModelOptions = require('./ModelOptions');
import _ = require('lodash');
import Bluebird = require('bluebird');

export = ModelHandlers;

class ModelHandlers<TDocument extends { _id?: any }, TInstance> {
    /**
     * Creates a new set of workflow handlers for the given Iridium model
     * @constructs Iridium.ModelHandlers
     * @param {Iridium.Model} model The model to which these workflow handlers should be bound
     * @memberof Iridium
     * @property {Iridium.Model} model The model to which these workflow handlers are bound
     */
    constructor(public model: Model<TDocument, TInstance>) {

    }

    /**
     * Performs operations relating to the intake of a document, including triggering of
     * the relevant hooks and wrapping of the document using the model's wrapping function.
     * @param {Any} conditions The conditions that were used when requesting the document, or null if this is the result of a creation request.
     * @param {Object} result The document returned by the database
     * @param {function(document, isNew, isPartial)} wrapper A function which will be used to wrap the document
     * @param {?QueryOptions} options The options controlling how the processing of this document is conducted
     * @returns {Promise<Any>}
     * @public
     */
    documentReceived<TResult>(conditions: any,
        result: TDocument,
        wrapper: (document: TDocument, isNew?: boolean, isPartial?: boolean) => TResult,
        options: ModelOptions.QueryOptions = {}): Bluebird<TResult> {
        _.defaults(options, {
            cache: true,
            partial: false
        });

        return Bluebird.resolve(result).then((target: any) => {
            return <Bluebird<TResult>>Bluebird.resolve().then(() => {
                // Trigger the received hook
                if (this.model.options.hooks.retrieved) this.model.options.hooks.retrieved(target);

                // Cache the document if caching is enabled
                if (this.model.core.cache && options.cache && !options.fields) {
                    this.model.cache.set(target); // Does not block execution pipeline - fire and forget
                }

                // Wrap the document and trigger the ready hook
                var wrapped: TResult = wrapper(target, false, !!options.fields);

                if (this.model.options.hooks.ready && wrapped instanceof this.model.Instance) this.model.options.hooks.ready(<TInstance><any>wrapped);
                return wrapped;
            });
        });
    }

    creatingDocuments(documents: TDocument[]): Bluebird<any[]> {
        return Bluebird.all(documents.map((document: any) => {
            return Bluebird.resolve().then(() => {
                if (this.model.options.hooks.retrieved) this.model.options.hooks.creating(document);
                var validation: SkmatcCore.IResult = this.model.helpers.validate(document);
                if (validation.failed) return Bluebird.reject(validation.error);
                return document;
            });
        }));
    }

    savingDocument(instance: TInstance, changes: any): Bluebird<TInstance> {
        return Bluebird.resolve().then(() => {
            if (this.model.options.hooks.saving) this.model.options.hooks.saving(instance, changes);
            return instance;
        });
    }
}
