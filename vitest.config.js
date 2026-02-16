import {defineConfig} from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            include: ['dist/**'],
            exclude: ['dist/*.map', 'dist/*.d.*'],
            reporter: ['text', 'html'],
            reportsDirectory: './coverage',
            all: true,
        }
    }
})
