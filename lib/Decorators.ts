/// <reference path="../_references.d.ts" />
import MongoDB = require('mongodb');
import _ = require('lodash');
import skmatc = require('skmatc');
import Instance from './Instance';
import {Index, IndexSpecification} from './Index';
import {Schema} from './Schema';
import InstanceImplementation from './InstanceInterface';

export function Collection(name: string) {
	return function(target: InstanceImplementation<any, any>) {
		target.collection = name;
	};
}

export function Index(spec: IndexSpecification, options?: MongoDB.IndexOptions) {
	return function(target: InstanceImplementation<any,any>) {
		target.indexes = (target.indexes || []).concat(<Index>{ spec: spec, options: options || {} });
	}
}

export function Validate(forType: any, validate: (schema: any, data: any, path: string) => Skmatc.Result) {
	return function(target: InstanceImplementation<any,any>) {
		target.validators = (target.validators || []).concat(skmatc.create(schema => schema === forType, validate));
	}
}

export function Property(asType: any, required?: boolean): (target: { constructor: Function }, name: string) => void;
export function Property(name: string, asType: any, required?: boolean): (target: Function) => void;
export function Property(...args: any[]): (target: any, name?: string) => void {
	let name = null,
		asType = false,
		required = true;
	
	if (args.length > 1 && typeof args[args.length - 1] === 'boolean')
		required = args.pop();
	
	return function(target: any, property?: string) {
		if (!property) name = args.shift();
		else {
			name = property;
			target = target.constructor;
		}
		asType = args.pop() || false;
		
		target.schema = _.clone(target.schema || {});
		if(!required && typeof asType !== 'boolean') target.schema[name] = { $required: required, $type: asType };
		else target.schema[name] = asType;
	}
}

export function Transform(fromDB: (value: any) => any, toDB: (value: any) => any) {
	return function(target: any, property: string) {
		target.constructor.transforms = _.clone(target.constructor.transforms || {})
		target.constructor.transforms[property] = {
			fromDB: fromDB,
			toDB: toDB
		};
	};
}

export function ObjectID(target: { constructor: typeof Instance }, name: string) {
	Property(MongoDB.ObjectID)(target, name);
	Transform(
		value => value && value._bsontype == 'ObjectID' ? new MongoDB.ObjectID(value.id).toHexString() : value,
		value => value && typeof value === 'string' ? new MongoDB.ObjectID(value) : value
	)(target, name);
}