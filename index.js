"use strict";

const path = require('path');

/**
 * @typedef {Record<string, import('@rspack/core').StatsModule>} ModuleMap
 * @typedef {{
 *      exclude?: RegExp;
 *      include?: RegExp;
 *      failOnError?: boolean;
 *      allowAsyncCycles?: boolean;
 *      onStart?: (x: { compilation: import('@rspack/core').Compilation }) => void;
 *      onDetected?: (x: { paths: string[]; compilation: import('@rspack/core').Compilation; }) => void;
 *      onEnd?: (x: { compilation: import('@rspack/core').Compilation }) => void;
 *      cwd?: string;
 * }} Options
 * @typedef {Required<Omit<Options, 'onStart' | 'onEnd' | 'onDetected'>> & Pick<Options, 'onStart' | 'onEnd' | 'onDetected'>} FullOptions
 */

const BASE_ERROR = "Circular dependency detected:\r\n";
const PluginTitle = "RspackCircularDependencyPlugin";

/**
 * @param {string|undefined} path
 */
const normalizePath = (path) => path?.replace(/^\.\//, "");

class RspackCircularDependencyPlugin {
    /**
     * @param {Options} options
     */
    constructor(options = {}) {
        /** @type {FullOptions} */
        this.options = {
            exclude: options.exclude ?? /$^/,
            include: options.include ?? /.*/,
            failOnError: options.failOnError ?? false,
            allowAsyncCycles: options.allowAsyncCycles ?? false,
            onStart: options.onStart,
            onDetected: options.onDetected,
            onEnd: options.onEnd,
            cwd: options.cwd ?? process.cwd(),
        };
    }

    /**
     * @param {import('@rspack/core').Compiler} compiler
     */
    apply(compiler) {
        compiler.hooks.compilation.tap(PluginTitle, (compilation) => {
            compilation.hooks.optimizeModules.tap(PluginTitle, (modules) => {
                this.options.onStart?.({ compilation });

                for (const module of modules) {
                    const shouldSkip = (
                        !module.resource ||
                        this.options.exclude.test(module.resource) ||
                        !this.options.include.test(module.resource)
                    );

                    if (shouldSkip) {
                        continue;
                    }

                    const maybeCyclicalPathsList = this.isCyclic(module, module, {}, compilation);
                    if (maybeCyclicalPathsList) {
                        if (this.options.onDetected) {
                            try {
                                this.options.onDetected({
                                    paths: maybeCyclicalPathsList,
                                    compilation,
                                });
                            } catch (/** @type {Error} */ err) {
                                compilation.errors.push(err);
                            }
                            continue;
                        }

                        const message = BASE_ERROR.concat(maybeCyclicalPathsList.join(" -> "));
                        if (this.options.failOnError) {
                            compilation.errors.push(new Error(message));
                        } else {
                            compilation.warnings.push(new Error(message));
                        }
                    }
                }

                this.options.onEnd?.({ compilation });
            });
        });
    }

    /**
     * @param {import('@rspack/core').Module} initialModule
     * @param {import('@rspack/core').Module} currentModule
     * @param {Record<string, boolean>} seenModules
     * @param {import('@rspack/core').Compilation} compilation
     * @returns {string[] | undefined}
     */
    isCyclic(initialModule, currentModule, seenModules, compilation) {
        // Add the current module to the seen modules cache
        seenModules[currentModule.id] = true;

        // If the modules aren't associated to resources
        // it's not possible to display how they are cyclical
        if (!currentModule.resource || !initialModule.resource) {
            return undefined;
        }

        // Iterate over the current modules dependencies
        for (const reason of currentModule.reasons ?? []) {
            const depModule = reason.moduleId ? compilation.moduleGraph.getModuleById(reason.moduleId) : undefined;

            if (!depModule || !depModule.resource) {
                continue;
            }

            // ignore dependencies that are resolved asynchronously
            if (this.options.allowAsyncCycles && reason.type?.match(/dynamic import|import\(\)/)) {
                continue;
            }

            // the dependency was resolved to the current module
            if (currentModule === depModule) {
                continue;
            }

            if (depModule.id in seenModules) {
                if (depModule.id === initialModule.id) {
                    // Initial module has a circular dependency
                    return [
                        path.relative(this.options.cwd, currentModule.resource),
                        path.relative(this.options.cwd, depModule.resource)
                    ];
                }
                // Found a cycle, but not for this module
                continue;
            }

            const maybeCyclicalPathsList = this.isCyclic(initialModule, depModule, seenModules, compilation);
            if (maybeCyclicalPathsList) {
                maybeCyclicalPathsList.unshift(path.relative(this.options.cwd, currentModule.resource));
                return maybeCyclicalPathsList;
            }
        }

        return undefined;
    }
}

module.exports = RspackCircularDependencyPlugin;
