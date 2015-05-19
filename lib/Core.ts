/// <reference path="../_references.d.ts" />
import Bluebird = require('bluebird');
import MongoDB = require('mongodb');
import _ = require('lodash');
import http = require('http');
import events = require('events');

import Config = require('./Configuration');
import IPlugin = require('./Plugins');
import Model = require('./Model');
import Instance = require('./Instance');

import middleware = require('./Middleware');
import ExpressMiddleware = require('./middleware/Express');

import Cache = require('./Cache');
import NoOpCache = require('./caches/NoOpCache');
import MemoryCache = require('./caches/MemoryCache');

var MongoConnectAsyc = Bluebird.promisify(MongoDB.MongoClient.connect);

export = Core;

class Core {
    /**
     * Creates a new Iridium Core instance connected to the specified MongoDB instance
     * @param {Iridium.Configuration} config The config object defining the database to connect to
     * @constructs Iridium.Core
     * @memberof Iridium
     */
    constructor(config: Config);
    /**
     * Creates a new Iridium Core instance connected to the specified MongoDB instance
     * @param {String} url The URL of the MongoDB instance to connect to
     * @param {Iridium.Configuration} config The config object made available as settings
     * @constructs Iridium.Core
     * @memberof Iridium
     */
    constructor(uri: string, config?: Config);
    /**
     * Creates a new Iridium Core instance connected to the specified MongoDB instance
     * @param {?String} url The URL of the MongoDB instance to connect to
     * @param {?Iridium.Configuration} config The config object made available as settings
     * @constructs Iridium.Core
     * @memberof Iridium
     */
    constructor(uri: string | Config, config?: Config) {
        var args = Array.prototype.slice.call(arguments, 0);
        uri = config = null;
        for (var i = 0; i < args.length; i++) {
            if (typeof args[i] == 'string')
                uri = args[i];
            else if (typeof args[i] == 'object')
                config = args[i];
        }

        if (!uri && !config) throw new Error("Expected either a URI or config object to be supplied when initializing Iridium");

        this._url = <string>uri;
        this._config = config;
    }

    
    private _plugins: IPlugin[] = [];
    private _url: string;
    private _config: Config;
    private _connection: MongoDB.Db;
    private _cache: Cache = new NoOpCache();
    
    /**
     * Gets the plugins registered with this Iridium Core
     * @returns {Iridium.Plugin[]}
     * @member {IPlugin[]} #plugins
     * @memberof Iridium.Core
     */
    get plugins(): IPlugin[] {
        return this._plugins;
    }

    /**
     * Gets the configuration specified in the construction of this
     * Iridium Core.
     * @returns {Iridium.Configuration}
     * @member {Iridium.Configuration} #settings
     * @memberof Iridium.Core
     */
    get settings(): Config {
        return this._config;
    }

    /**
     * Gets the currently active database connection for this Iridium
     * Core.
     * @returns {MongoDB.Db}
     * @member {MongoDB.Db} #connection
     * @memberof Iridium.Core
     */
    get connection(): MongoDB.Db {
        return this._connection;
    }

    /**
     * Gets the URL used to connect to MongoDB
     * @returns {String}
     * @member {String} #url
     * @memberof Iridium.Core
     */
    get url(): string {
        if (this._url) return this._url;
        var url: string = 'mongodb://';

        if (this._config.username) {
            url += this._config.username;
            if (this._config.password)
                url += ':' + this._config.password;
            url += '@';
        }

        var hosts = [];

        if (this._config.host) {
            if (this._config.port)
                hosts.push(this._config.host + ':' + this._config.port);
            else
                hosts.push(this._config.host);
        }

        if (this._config.hosts) {
            _.each(this._config.hosts, (host) => {
                if (host.port)
                    hosts.push(host.address + ':' + host.port);
                else
                    hosts.push(host.address);
            });
        }

        if (hosts.length)
            url += _.uniq(hosts).join(',');
        else
            url += 'localhost';

        url += '/' + this._config.database;

        return url;
    }

    /**
     * Gets or sets the cache used to store objects retrieved from the database for performance reasons
     * @returns {cache}
     * @member {Iridium.Cache} #cache
     * @memberof Iridium.Core
     */
    get cache(): Cache {
        return this._cache;
    }
    set cache(value: Cache) {
        this._cache = value;
    }

    /**
     * Registers a new plugin with this Iridium Core
     * @param {Iridium.Plugin} plugin The plugin to register with this Iridium Core
     * @public
     * @returns {Iridium.Core}
     */
    register(plugin: IPlugin): Core {
        this.plugins.push(plugin);
        return this;
    }

    /**
     * Connects to the database server specified in the provided configuration
     * @param {?function(Error, Iridium.Core)} [callback] A callback to be triggered once the connection is established.
     * @public
     * @returns {Promise}
     */
    connect(callback?: (err: Error, core: Core) => any): Bluebird<Core> {
        var self = this;
        return Bluebird.bind(this).then(function() {
            if (self._connection) return self._connection;
            return MongoConnectAsyc(self.url);
        }).then(function(db: MongoDB.Db) {
            self._connection = db;
            return self;
        }).nodeify(callback);
    }

    /**
     * Closes the active database connection
     * @public
     * @type {Promise}
     */
    close(): Bluebird<Core> {
        var self = this;
        return Bluebird.bind(this).then(function() {
            if (!self._connection) return this;
            var conn: MongoDB.Db = self._connection;
            self._connection = null;
            conn.close();
            return this;
        });
    }

    /**
     * Provides an express middleware which can be used to set the req.db property
     * to the current Iridium instance.
     * @public
     * @returns {Iridium.ExpressMiddleware}
     */
    express(): ExpressMiddleware.ExpressMiddleware {
        return ExpressMiddleware.ExpressMiddlewareFactory(this);
    }
}


/**
 * @typedef {Object} Configuration
 * @memberof Iridium
 * 
 * @property {?String} host - The fully qualified hostname of the database server
 * @property {?Number} port - The port on the database server to make use of, defaults to 27016
 * @property {?Array<Iridium.ConfigurationHost>} hosts - The host specs of the different database servers to connect to
 * @property {?String} database - The name of the MongoDB database you wish to connect to
 * @property {?String} username - The username to be used when authenticating with MongoDB
 * @property {?String} password - The password to use when authenticating with MongoDB
 */

/**
 * @typedef {Object} ConfigurationHost
 * @memberof Iridium
 * @property {String} address - The fully qualified hostname of the database instance
 * @property {?Number} port - The port number to connect to, defaults to the configuration object's port.
 */