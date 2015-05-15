;(function (global, namespace) {
    'use strict'

     /*
        Dependencies:
        $.Deferred, $.when

        todo: remove dependencies
     */

    var noop = function () {},
        console = window.console || {
            log: noop,
            warn: noop,
            info: noop,
            error: noop
        },
        log = function () {
            return console.log.apply(console, arguments);
        };

    log._formatError = function (error) {
            var stack = error.stack;

            if (stack) {
                error = (error.message && stack.indexOf(error.message) === -1)
                    ? 'Error: ' + error.message + '\n' + stack
                    : stack;
            } else if (error.sourceURL) {
                error = error.message + '\n' + error.sourceURL + ':' + error.line;
            }

            return error;
        };

    log.error = function () {
        if (arguments[0] instanceof Error) {
            console.error(this._formatError(arguments[0]));
        } else {
            console.error.apply(console, arguments);
        }
    };

    log.warn = function () {
        console.warn.apply(console, arguments);
    };

    log.info = function () {
        console.info.apply(console, arguments);
    };

    function DependencyInjector () {
        this._Error = this._getErrorConstructor('injector');
        this._services = {};
        this._configuration = {};
        this._loading = {};
        this.paths = {};
        this.shims = [];
        this.basePath = '/';
    };

    DependencyInjector.prototype = {
        service: function (name, deps, constructor) {
            if (arguments.length === 1) {
                var serviceDefinition = this._getServiceDefinition(name);

                return serviceDefinition && serviceDefinintion.instance;
            }

            var that = this;

            this._defineService.apply(that, arguments);

            return function () {
                return that._getServicePromise(name);
            };
        },

        hasService: function (name) {
            return Boolean(this._getServiceDefinition(name));
        },

        config: function (serviceName, params) {
            var config = this._configuration[serviceName] = this._configuration[serviceName] || {};

            return this._extend(config, params);
        },

        require: function (deps, onDone, onFail) {
            return this._require(deps).then(onDone, onFail);
        },

        loadScript: function (service) {
            var that = this, defer = this._deferred(),
                node = document.createElement('script'),
                path = this.basePath + (that.paths[service] || service);

            node.src = /\.js$/.path ? path : path + '.js';
            node.onload = function () {
                if (that.shims.indexOf(service) > -1) {
                    that.service(service, function () {});
                }

                defer.resolve();
            };

            node.onerror = function () {
                console.error('Loading error', service);
            };

            document.getElementsByTagName('head')[0].appendChild(node);

            return defer.promise();
        },

        _require: function (deps, chain) {
            var queue = [];

            deps = deps instanceof Array ? deps : [deps];
            deps = deps.slice();
            chain = chain || [];

            for (var i = 0, length = deps.length; i < length; i++) {
                var depName = deps[i];

                if (chain.indexOf(depName) !== -1) {
                    chain.push(depName);
                    return this._getRejectedPromise('01', 'Circular dependency found: {0}', chain.join(' -> '));
                }

                queue.push(this._getServicePromise(depName, chain).then(function (service) {
                    return service;
                }));
            }

            return this._when(queue);
        },

        _getServiceDefinition: function (name) {
            return this._services[name];
        },

        _getServicePromise: function (name, chain) {
            var that = this,
                initiator = chain && chain[chain.length - 1],
                local = this._getLocalServices(name, initiator)[name],
                service = this._getServiceDefinition(name),
                defer = this._deferred();

            if (local) {
                return defer.resolve(local).promise();
            }

            if (!service) {
                return this._loading[name] ? this._loading[name] : this._loading[name] = this.loadScript(name).then(function () {
                    delete that._loading[name];

                    if (!that.hasService(name)) {
                        return that._getRejectedPromise('02', 'Undefined service "{0}"', name);
                    }

                    return that._getServicePromise(name, chain);
                }, function (errorMessage) {
                    delete that._loading[name];

                    return initiator ?
                        that._getRejectedPromise('03', 'Service "{0}" can not be required by "{1}" service. {2}', name, initiator, errorMessage) :
                        that._getRejectedPromise('03', 'Service "{0}" can not be required. {1}', name, errorMessage);
                });
            }

            if (service.promise) {
                return service.promise;
            }

            chain = chain instanceof Array ? chain.slice() : [];
            chain.push(name);

            this._require(service.deps, chain).then(function () {
                try {
                    defer.resolve(service.instance = that._constructService(arguments, service.constructor));
                } catch (e) {
                    defer.reject(that._error(e));
                }
            });

            return service.promise = defer.promise();
        },

        _defineService: function (name, deps, constructor) {
            if (typeof arguments[1] === 'function') {
                constructor = arguments[1];
                deps = [];
            }

            this._services[name] = this._services[name] || {
                deps: deps,
                constructor: constructor
            };
        },

        _constructService: function (deps, fn) {
            var exports,
                service = new function Constructor () {
                    return exports = fn.apply(this, deps);
                };

            return (exports === undefined || exports instanceof Object) ? service : exports;
        },

        _error: function () {
            var error = arguments.length > 1 ? this._Error.apply(this, arguments) : arguments[0];
            log.error(error);

            return error;
        },

        _getRejectedPromise: function () {
            var error = this._error.apply(this, arguments);

            return this._deferred().reject(error).promise();
        },

        _extend: function (dst) {
            for (var i = 1, iLength = arguments.length; i < iLength; i++) {
                if (!arguments[i]) {
                    continue;
                }

                var obj = arguments[i],
                    keys = Object.keys(obj);

                for (var j = 0, jLength = keys.length; j < jLength; j++) {
                    var key = keys[j],
                        typeOfValue = Object.prototype.toString.call(obj[key]);

                    if (typeOfValue === '[object Object]' || typeOfValue === '[object Array]') {
                        dst[key] = dst[key] || (obj[key] instanceof Array ? [] : {});
                        dst[key] = this._extend(dst[key], obj[key]);
                    } else {
                        dst[key] = obj[key];
                    }
                }
            }

            return dst;
        },

        _getLocalServices: function (selfName, initiatorName) {
            var locals = {
                $error: this._getErrorConstructor(initiatorName),
                $injector: this,
                $log: log
            };

            if (initiatorName) {
                locals.$config = this.config(initiatorName);
            }

            return locals;
        },

        _getErrorConstructor: function (module, ErrorConstructor) {
            ErrorConstructor = ErrorConstructor || Error;

            return function (code, template) {
                if (arguments.length === 1) {
                    template = arguments[0];
                    code = undefined;
                }

                var prefix = [],
                    args = arguments;

                if (module) {
                    prefix.push(module);
                }

                if (code !== undefined) {
                    prefix.push(code);
                }

                prefix = '[' + prefix.join(':') + '] ';

                var message = prefix + template.replace(/\{(\d+)\}/g, function (match, p1) {
                        var index = Number(p1) + 2,
                            arg;

                        if (index < args.length) {
                            arg = args[index];

                            if (typeof arg === 'function') {
                                return arg.toString().replace(/ ?\{[\s\S]*$/, '');
                            } else if (typeof arg === 'undefined') {
                                return 'undefined';
                            } else if (typeof arg !== 'string') {
                                return JSON.stringify(arg);
                            }

                            return arg;
                        }

                        return match;
                    });

                return new ErrorConstructor(message);
            }
        },

        // PROXY:
        _when: function () {
            return $.when.apply($, arguments[0]);
        },

        _deferred: function () {
            return $.Deferred.apply($, arguments);
        }
    };

    global[namespace] = new DependencyInjector();
})(window, 'di');
