import type { Compiler, Compilation, StatsModule } from "@rspack/core";

type ModuleMap = Record<string, StatsModule>;

export interface Options {
    exclude?: RegExp;
    include?: RegExp;
    failOnError?: boolean;
    allowAsyncCycles?: boolean;
    onStart?: (x: { compilation: Compilation }) => void;
    onDetected?: (x: { paths: string[]; compilation: Compilation }) => void;
    onEnd?: (x: { compilation: Compilation }) => void;
}

type FullOptions = Required<Omit<Options, "onStart" | "onEnd" | "onDetected">> &
    Pick<Options, "onStart" | "onEnd" | "onDetected">;

const BASE_ERROR = "Circular dependency detected:\r\n";
const PluginTitle = "RspackCircularDependencyPlugin";

const normalizePath = (path: string | undefined): string | undefined =>
    path?.replace(/^\.\//, "");

class RspackCircularDependencyPlugin {
    options: FullOptions;

    constructor(options: Options = {}) {
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

    apply(compiler: Compiler): void {
        compiler.hooks.afterCompile.tap(PluginTitle, (compilation) => {
            this.options.onStart?.({ compilation });
            const stats = compilation.getStats().toJson();

            const modulesById: ModuleMap = Object.fromEntries(
                (stats.modules ?? [])
                    .filter(
                        (module) =>
                            !module.orphan &&
                            !!module.name &&
                            module.name.match(this.options.include) &&
                            !module.name.match(this.options.exclude)
                    )
                    .map((module) => [module.id, module])
            );

            for (const module of Object.keys(modulesById)) {
                const maybeCyclicalPathsList = this.isCyclic(
                    module,
                    module,
                    modulesById
                );

                if (maybeCyclicalPathsList) {
                    if (this.options.onDetected) {
                        try {
                            this.options.onDetected({
                                paths: maybeCyclicalPathsList,
                                compilation,
                            });
                        } catch (err: unknown) {
                            compilation.errors.push(err as Error);
                        }
                    } else {
                        const message = BASE_ERROR.concat(
                            maybeCyclicalPathsList.join(" -> ")
                        );
                        if (this.options.failOnError) {
                            compilation.errors.push(new Error(message));
                        } else {
                            compilation.warnings.push(new Error(message));
                        }
                    }
                }
            }

            this.options.onEnd?.({ compilation });
        });
    }

    isCyclic(
        initialModule: string,
        currentModule: string,
        modulesById: ModuleMap,
        seenModules: Record<string, boolean> = {}
    ): string[] | undefined {
        const currentModuleName = modulesById[currentModule]?.name;
        seenModules[currentModule] = true;

        for (const reason of modulesById[currentModule].reasons ?? []) {
            const reasonModule = reason.moduleId
                ? modulesById[reason.moduleId]
                : undefined;

            if (!reasonModule?.id) {
                continue;
            }

            if (
                this.options.allowAsyncCycles &&
                reason.type?.match(/dynamic import|import\(\)/)
            ) {
                continue;
            }

            if (reasonModule.id in seenModules) {
                if (
                    reasonModule.id === initialModule &&
                    currentModule !== initialModule
                ) {
                    return [
                        normalizePath(reasonModule?.name) ??
                            String(reasonModule.id),
                        normalizePath(currentModuleName) ?? currentModule,
                    ];
                }
                continue;
            }

            const maybeCyclicalPathsList = this.isCyclic(
                initialModule,
                String(reasonModule.id),
                modulesById,
                seenModules
            );

            if (maybeCyclicalPathsList) {
                return [
                    ...maybeCyclicalPathsList,
                    normalizePath(currentModuleName) ?? currentModule,
                ];
            }
        }
    }
}

export default RspackCircularDependencyPlugin;
