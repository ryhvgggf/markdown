import { describe } from 'vitest'
import { describeDirContract } from './dir-contract'
import { memoryDir } from './memory-dir'

describe('memoryDir', () => {
  let t = 1000
  describeDirContract(() => memoryDir(() => ++t))
})
