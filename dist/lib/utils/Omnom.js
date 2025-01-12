/// <reference path="../../_references.d.ts" />
var _ = require('lodash');
var MongoDB = require('mongodb');
var Omnom = (function () {
    function Omnom(options) {
        if (options === void 0) { options = {}; }
        this.options = options;
        this._changes = {};
    }
    Object.defineProperty(Omnom.prototype, "changes", {
        get: function () {
            return this._changes;
        },
        enumerable: true,
        configurable: true
    });
    Omnom.prototype.diff = function (original, modified) {
        this.onObject(original, modified);
        return this;
    };
    Omnom.diff = function (original, modified, options) {
        return new Omnom(options).diff(original, modified).changes;
    };
    Omnom.prototype.onObject = function (original, modified, changePath) {
        if (original === undefined || original === null)
            return (original !== modified) && this.set(changePath, modified);
        if (typeof original == 'number' && typeof modified == 'number' && original !== modified) {
            if (this.options.atomicNumbers)
                return this.inc(changePath, modified - original);
            return this.set(changePath, modified);
        }
        if (Array.isArray(original) && Array.isArray(modified))
            return this.onArray(original, modified, changePath);
        if (original instanceof MongoDB.ObjectID && modified instanceof MongoDB.ObjectID)
            return !original.equals(modified) && this.set(changePath, modified);
        if (!_.isPlainObject(original) || !_.isPlainObject(modified))
            return !_.isEqual(original, modified) && this.set(changePath, modified);
        _.each(modified, function (value, key) {
            // Handle array diffs in their own special way
            if (Array.isArray(value) && Array.isArray(original[key]))
                this.onArray(original[key], value, this.resolve(changePath, key));
            else
                this.onObject(original[key], value, this.resolve(changePath, key));
        }, this);
        // Unset removed properties
        _.each(original, function (value, key) {
            if (modified[key] === undefined || modified[key] === null)
                return this.unset(this.resolve(changePath, key));
        }, this);
    };
    Omnom.prototype.onArray = function (original, modified, changePath) {
        var _this = this;
        var i, j;
        // Check if we can get from original => modified using just pulls
        if (original.length > modified.length) {
            var pulls = [];
            for (i = 0, j = 0; i < original.length && j < modified.length; i++) {
                if (this.almostEqual(original[i], modified[j]))
                    j++;
                else
                    pulls.push(original[i]);
            }
            for (; i < original.length; i++)
                pulls.push(original[i]);
            if (j === modified.length) {
                if (pulls.length === 1)
                    return this.pull(changePath, pulls[0]);
                // We can complete using just pulls
                return pulls.forEach(function (pull) { return _this.pull(changePath, pull); });
            }
            else
                return this.set(changePath, modified);
        }
        // Check if we can get from original => modified using just pushes
        if (original.length < modified.length) {
            var canPush = true;
            for (i = 0; i < original.length; i++)
                if (this.almostEqual(original[i], modified[i]) < 1) {
                    canPush = false;
                    break;
                }
            if (canPush) {
                for (i = original.length; i < modified.length; i++)
                    this.push(changePath, modified[i]);
                return;
            }
        }
        // Otherwise, we need to use $set to generate the new array
        // Check how many manipulations would need to be performed, if it's more than half the array size
        // then rather re-create the array
        var sets = [];
        var partials = [];
        for (i = 0; i < modified.length; i++) {
            var equality = this.almostEqual(original[i], modified[i]);
            if (equality === 0)
                sets.push(i);
            else if (equality < 1)
                partials.push(i);
        }
        if (sets.length > modified.length / 2)
            return this.set(changePath, modified);
        for (i = 0; i < sets.length; i++)
            this.set(this.resolve(changePath, sets[i].toString()), modified[sets[i]]);
        for (i = 0; i < partials.length; i++)
            this.onObject(original[partials[i]], modified[partials[i]], this.resolve(changePath, partials[i].toString()));
    };
    Omnom.prototype.set = function (path, value) {
        if (!this.changes.$set)
            this.changes.$set = {};
        this.changes.$set[path] = value;
    };
    Omnom.prototype.unset = function (path) {
        if (!this.changes.$unset)
            this.changes.$unset = {};
        this.changes.$unset[path] = 1;
    };
    Omnom.prototype.inc = function (path, value) {
        if (!this.changes.$inc)
            this.changes.$inc = {};
        this.changes.$inc[path] = value;
    };
    Omnom.prototype.push = function (path, value) {
        if (!this.changes.$push)
            this.changes.$push = {};
        if (this.changes.$push[path]) {
            if (this.changes.$push[path].$each)
                this.changes.$push[path].$each.push(value);
            else
                this.changes.$push[path] = { $each: [this.changes.$push[path], value] };
        }
        else
            this.changes.$push[path] = value;
    };
    Omnom.prototype.pull = function (path, value) {
        if (!this.changes.$pull)
            this.changes.$pull = {};
        if (this.changes.$pullAll && this.changes.$pullAll[path]) {
            return this.changes.$pullAll[path].push(value);
        }
        if (this.changes.$pull[path]) {
            this.pullAll(path, [this.changes.$pull[path], value]);
            delete this.changes.$pull[path];
            if (_.keys(this.changes.$pull).length === 0)
                delete this.changes.$pull;
            return;
        }
        this.changes.$pull[path] = value;
    };
    Omnom.prototype.pullAll = function (path, values) {
        if (!this.changes.$pullAll)
            this.changes.$pullAll = {};
        this.changes.$pullAll[path] = values;
    };
    Omnom.prototype.resolve = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i - 0] = arguments[_i];
        }
        var validArguments = [];
        args.forEach(function (arg) {
            if (arg)
                validArguments.push(arg);
        });
        return validArguments.join('.');
    };
    Omnom.prototype.almostEqual = function (o1, o2) {
        if (!_.isPlainObject(o1) || !_.isPlainObject(o2))
            return o1 == o2 ? 1 : 0;
        var o1i, o1k = Object.keys(o1);
        var o2k = Object.keys(o2);
        var commonKeys = [];
        for (o1i = 0; o1i < o1k.length; o1i++)
            if (~o2k.indexOf(o1k[o1i]))
                commonKeys.push(o1k[o1i]);
        var totalKeys = o1k.length + o2k.length - commonKeys.length;
        var keysDifference = totalKeys - commonKeys.length;
        var requiredChanges = 0;
        for (var i = 0; i < commonKeys.length; i++)
            if (this.almostEqual(o1[commonKeys[i]], o2[commonKeys[i]]) < 1)
                requiredChanges++;
        return 1 - (keysDifference / totalKeys) - (requiredChanges / commonKeys.length);
    };
    return Omnom;
})();
exports.default = Omnom;

//# sourceMappingURL=../../lib/utils/Omnom.js.map