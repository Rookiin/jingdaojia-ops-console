/**
 * 兼容别名：种子生成器实现位于 src/data/generate.js（docs §4.2 契约路径）。
 * 保留 buildSeed / SEED_TARGETS 的旧导入路径。
 */
export {
  buildSeed,
  buildSeed as default,
  SEED_TARGETS,
  SEED_SCALE,
  SEED_ID,
  SEED_PERIOD,
  SEED_RANDOM_SEED,
} from './generate.js'
