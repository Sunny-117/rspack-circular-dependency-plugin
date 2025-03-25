"use strict";

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
        };
    }

    /**
     * @param {import('@rspack/core').Compiler} compiler
     */
    apply(compiler) {
        compiler.hooks.afterCompile.tap(PluginTitle, (compilation) => {
            this.options.onStart?.({ compilation });
            const stats = compilation.getStats().toJson({ modules: true, chunkModules: false });

            /** @type {Map<string, import('@rspack/core').StatsModule>} */
            const modulesById = new Map();
            for (const module of stats.modules ?? []) {
                if (!module.orphan && module.name && module.name.match(this.options.include) && !module.name.match(this.options.exclude)) {
                    modulesById.set(module.id, module);
                }
            }

            const checkedModules = new Set();
            for (const module of modulesById.keys()) {
                if (!checkedModules.has(module)) {
                    const maybeCyclicalPathsList = this.isCyclic(module, module, modulesById, new Set());
                    if (maybeCyclicalPathsList) {
                        checkedModules.add(module);
                        this.reportCycle(maybeCyclicalPathsList, compilation);
                    }
                }
            }
            
            this.options.onEnd?.({ compilation });
        });
    }

    /**
     * @param {string} initialModule
     * @param {string} currentModule
     * @param {Map<string, import('@rspack/core').StatsModule>} modulesById
     * @param {Set<string>} seenModules
     * @returns {string[] | undefined}
     */
    isCyclic(initialModule, currentModule, modulesById, seenModules = new Set()) {
        if (seenModules.has(currentModule)) return;
        seenModules.add(currentModule);

        const currentModuleName = modulesById.get(currentModule)?.name;
        for (const reason of modulesById.get(currentModule)?.reasons ?? []) {
            const reasonModuleId = reason.moduleId;
            if (!reasonModuleId || !modulesById.has(reasonModuleId)) continue;

            if (this.options.allowAsyncCycles && reason.type?.match(/dynamic import|import\(\)/)) continue;

            if (reasonModuleId === initialModule && currentModule !== initialModule) {
                return [normalizePath(modulesById.get(reasonModuleId)?.name) ?? reasonModuleId, normalizePath(currentModuleName) ?? currentModule];
            }

            const cyclePath = this.isCyclic(initialModule, reasonModuleId, modulesById, seenModules);
            if (cyclePath) {
                return [...cyclePath, normalizePath(currentModuleName) ?? currentModule];
            }
        }
    }

    /**
     * @param {string[]} paths
     * @param {import('@rspack/core').Compilation} compilation
     */
    reportCycle(paths, compilation) {
        if (this.options.onDetected) {
            try {
                this.options.onDetected({ paths, compilation });
            } catch (err) {
                compilation.errors.push(err);
            }
        } else {
            const message = BASE_ERROR.concat(paths.join(" -> "));
            if (this.options.failOnError) {
                compilation.errors.push(new Error(message));
            } else {
                compilation.warnings.push(new Error(message));
            }
        }
    }
}

module.exports = RspackCircularDependencyPlugin;
