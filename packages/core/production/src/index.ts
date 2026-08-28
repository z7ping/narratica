import type {
  Generation,
  GenerationId,
  MediaAssetId,
  ProductionAttempt,
  ProductionAttemptId,
  ProductionProviderInputValue,
  ProductionSourceRef,
  ProductionTask,
  ProductionTaskId,
  ProviderId,
} from '@narratica/contracts'

export type ProductionCoreErrorCode =
  | 'TASK_NOT_FOUND'
  | 'ATTEMPT_NOT_FOUND'
  | 'GENERATION_NOT_FOUND'
  | 'INVALID_TASK_STATE'
  | 'INVALID_ATTEMPT_STATE'
  | 'INVALID_GENERATION_SELECTION'
  | 'DUPLICATE_RUNTIME_ID'
  | 'INVALID_RUNTIME_SNAPSHOT'

export class ProductionCoreError extends Error {
  constructor(
    message: string,
    readonly code: ProductionCoreErrorCode,
  ) {
    super(message)
    this.name = 'ProductionCoreError'
  }
}

export interface ProductionLedgerSnapshot {
  readonly tasks: readonly ProductionTask[]
  readonly attempts: readonly ProductionAttempt[]
  readonly generations: readonly Generation[]
}

interface MutableTask {
  taskId: ProductionTaskId
  source: ProductionSourceRef
  providerId: ProviderId
  input: Readonly<Record<string, ProductionProviderInputValue>>
  status: ProductionTask['status']
  attemptIds: ProductionAttemptId[]
  generationIds: GenerationId[]
  selectedGenerationId: GenerationId | null
  createdAt: string
  updatedAt: string
  error?: string
}

interface MutableAttempt {
  attemptId: ProductionAttemptId
  taskId: ProductionTaskId
  number: number
  status: ProductionAttempt['status']
  startedAt: string
  finishedAt: string | null
  error?: string
}

interface MutableGeneration {
  generationId: GenerationId
  taskId: ProductionTaskId
  attemptId: ProductionAttemptId
  providerId: ProviderId
  assetId: MediaAssetId
  status: Generation['status']
  createdAt: string
}

function taskView(task: MutableTask): ProductionTask {
  return Object.freeze({
    ...task,
    source: Object.freeze({ ...task.source }),
    input: Object.freeze({ ...task.input }),
    attemptIds: Object.freeze([...task.attemptIds]),
    generationIds: Object.freeze([...task.generationIds]),
  })
}

function attemptView(attempt: MutableAttempt): ProductionAttempt {
  return Object.freeze({ ...attempt })
}

function generationView(generation: MutableGeneration): Generation {
  return Object.freeze({ ...generation })
}

function mutableTask(task: ProductionTask): MutableTask {
  return {
    taskId: task.taskId,
    source: { ...task.source },
    providerId: task.providerId,
    input: Object.freeze({ ...task.input }),
    status: task.status,
    attemptIds: [...task.attemptIds],
    generationIds: [...task.generationIds],
    selectedGenerationId: task.selectedGenerationId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.error === undefined ? {} : { error: task.error }),
  }
}

function mutableAttempt(attempt: ProductionAttempt): MutableAttempt {
  return {
    attemptId: attempt.attemptId,
    taskId: attempt.taskId,
    number: attempt.number,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    ...(attempt.error === undefined ? {} : { error: attempt.error }),
  }
}

function mutableGeneration(generation: Generation): MutableGeneration {
  return { ...generation }
}

function stableById<T>(items: readonly T[], id: (item: T) => string): T[] {
  return [...items].sort((left, right) => id(left).localeCompare(id(right)))
}

function sameCreativeSource(left: ProductionSourceRef, right: ProductionSourceRef): boolean {
  return left.kind === right.kind
    && left.projectId === right.projectId
    && left.episodeId === right.episodeId
    && left.stage === right.stage
    && left.sourceId === right.sourceId
}

export class ProductionLedger {
  private readonly tasks = new Map<ProductionTaskId, MutableTask>()
  private readonly attempts = new Map<ProductionAttemptId, MutableAttempt>()
  private readonly generations = new Map<GenerationId, MutableGeneration>()

  constructor(snapshot?: ProductionLedgerSnapshot) {
    if (snapshot !== undefined) this.restore(snapshot)
  }

  snapshot(): ProductionLedgerSnapshot {
    return Object.freeze({
      tasks: Object.freeze(stableById([...this.tasks.values()].map(taskView), item => item.taskId)),
      attempts: Object.freeze(stableById([...this.attempts.values()].map(attemptView), item => item.attemptId)),
      generations: Object.freeze(stableById(
        [...this.generations.values()].map(generationView),
        item => item.generationId,
      )),
    })
  }

  recoverInterrupted(input: { readonly at: string; readonly error: string }): number {
    let recovered = 0
    for (const attempt of this.attempts.values()) {
      if (attempt.status !== 'running') continue
      const task = this.requireTask(attempt.taskId)
      attempt.status = 'failed'
      attempt.finishedAt = input.at
      attempt.error = input.error
      if (task.status === 'running') {
        task.status = 'failed'
        task.updatedAt = input.at
        task.error = input.error
      }
      recovered += 1
    }
    return recovered
  }

  createTask(input: {
    readonly taskId: ProductionTaskId
    readonly source: ProductionSourceRef
    readonly providerId: ProviderId
    readonly providerInput: Readonly<Record<string, ProductionProviderInputValue>>
    readonly at: string
  }): ProductionTask {
    if (this.tasks.has(input.taskId)) {
      throw new ProductionCoreError(`duplicate task id: ${input.taskId}`, 'DUPLICATE_RUNTIME_ID')
    }
    const task: MutableTask = {
      taskId: input.taskId,
      source: { ...input.source },
      providerId: input.providerId,
      input: Object.freeze({ ...input.providerInput }),
      status: 'pending',
      attemptIds: [],
      generationIds: [],
      selectedGenerationId: null,
      createdAt: input.at,
      updatedAt: input.at,
    }
    this.tasks.set(task.taskId, task)
    return taskView(task)
  }

  startAttempt(input: {
    readonly taskId: ProductionTaskId
    readonly attemptId: ProductionAttemptId
    readonly at: string
  }): { readonly task: ProductionTask; readonly attempt: ProductionAttempt } {
    const task = this.requireTask(input.taskId)
    if (task.status !== 'pending') {
      throw new ProductionCoreError(
        `task ${task.taskId} must be pending before first attempt, actual ${task.status}`,
        'INVALID_TASK_STATE',
      )
    }
    if (this.attempts.has(input.attemptId)) {
      throw new ProductionCoreError(`duplicate attempt id: ${input.attemptId}`, 'DUPLICATE_RUNTIME_ID')
    }
    const attempt: MutableAttempt = {
      attemptId: input.attemptId,
      taskId: task.taskId,
      number: task.attemptIds.length + 1,
      status: 'running',
      startedAt: input.at,
      finishedAt: null,
    }
    this.attempts.set(attempt.attemptId, attempt)
    task.attemptIds.push(attempt.attemptId)
    task.status = 'running'
    task.updatedAt = input.at
    delete task.error
    return { task: taskView(task), attempt: attemptView(attempt) }
  }

  succeedAttempt(input: {
    readonly taskId: ProductionTaskId
    readonly attemptId: ProductionAttemptId
    readonly generationId: GenerationId
    readonly assetId: MediaAssetId
    readonly at: string
  }): {
    readonly task: ProductionTask
    readonly attempt: ProductionAttempt
    readonly generation: Generation
  } {
    const task = this.requireTask(input.taskId)
    const attempt = this.requireAttempt(input.attemptId)
    if (task.status !== 'running' || attempt.status !== 'running' || attempt.taskId !== task.taskId) {
      throw new ProductionCoreError(
        `task/attempt is not running: ${task.taskId}/${attempt.attemptId}`,
        'INVALID_ATTEMPT_STATE',
      )
    }
    if (this.generations.has(input.generationId)) {
      throw new ProductionCoreError(`duplicate generation id: ${input.generationId}`, 'DUPLICATE_RUNTIME_ID')
    }

    const generation: MutableGeneration = {
      generationId: input.generationId,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      providerId: task.providerId,
      assetId: input.assetId,
      status: 'candidate',
      createdAt: input.at,
    }
    this.generations.set(generation.generationId, generation)
    task.generationIds.push(generation.generationId)
    task.status = 'succeeded'
    task.updatedAt = input.at
    delete task.error
    attempt.status = 'succeeded'
    attempt.finishedAt = input.at
    delete attempt.error

    return {
      task: taskView(task),
      attempt: attemptView(attempt),
      generation: generationView(generation),
    }
  }

  failAttempt(input: {
    readonly taskId: ProductionTaskId
    readonly attemptId: ProductionAttemptId
    readonly error: string
    readonly at: string
  }): { readonly task: ProductionTask; readonly attempt: ProductionAttempt } {
    const task = this.requireTask(input.taskId)
    const attempt = this.requireAttempt(input.attemptId)
    if (task.status !== 'running' || attempt.status !== 'running' || attempt.taskId !== task.taskId) {
      throw new ProductionCoreError(
        `task/attempt is not running: ${task.taskId}/${attempt.attemptId}`,
        'INVALID_ATTEMPT_STATE',
      )
    }
    task.status = 'failed'
    task.updatedAt = input.at
    task.error = input.error
    attempt.status = 'failed'
    attempt.finishedAt = input.at
    attempt.error = input.error
    return { task: taskView(task), attempt: attemptView(attempt) }
  }

  selectGeneration(input: {
    readonly taskId: ProductionTaskId
    readonly generationId: GenerationId
    readonly at: string
  }): {
    readonly task: ProductionTask
    readonly generation: Generation
    readonly previousGeneration: Generation | null
  } {
    const task = this.requireTask(input.taskId)
    const generation = this.requireGeneration(input.generationId)
    if (task.status !== 'succeeded' || generation.taskId !== task.taskId) {
      throw new ProductionCoreError(
        `generation ${generation.generationId} does not belong to succeeded task ${task.taskId}`,
        'INVALID_GENERATION_SELECTION',
      )
    }
    if (generation.status === 'rejected') {
      throw new ProductionCoreError(
        `rejected generation cannot be selected: ${generation.generationId}`,
        'INVALID_GENERATION_SELECTION',
      )
    }

    // “当前采用”属于同一作品、同一集、同一生产用途下的创作来源，而不是某一次 Task。
    let previousGeneration: Generation | null = null
    for (const candidateTask of this.tasks.values()) {
      if (!sameCreativeSource(candidateTask.source, task.source)) continue
      const previousId = candidateTask.selectedGenerationId
      if (previousId === null || previousId === generation.generationId) continue
      const previous = this.requireGeneration(previousId)
      previous.status = 'superseded'
      if (previousGeneration === null) previousGeneration = generationView(previous)
      candidateTask.selectedGenerationId = null
      candidateTask.updatedAt = input.at
    }

    generation.status = 'selected'
    task.selectedGenerationId = generation.generationId
    task.updatedAt = input.at

    return {
      task: taskView(task),
      generation: generationView(generation),
      previousGeneration,
    }
  }

  getTask(taskId: ProductionTaskId): ProductionTask {
    return taskView(this.requireTask(taskId))
  }

  getAttempt(attemptId: ProductionAttemptId): ProductionAttempt {
    return attemptView(this.requireAttempt(attemptId))
  }

  getGeneration(generationId: GenerationId): Generation {
    return generationView(this.requireGeneration(generationId))
  }

  private restore(snapshot: ProductionLedgerSnapshot): void {
    for (const task of snapshot.tasks) {
      if (this.tasks.has(task.taskId)) {
        throw new ProductionCoreError(`duplicate restored task id: ${task.taskId}`, 'INVALID_RUNTIME_SNAPSHOT')
      }
      this.tasks.set(task.taskId, mutableTask(task))
    }
    for (const attempt of snapshot.attempts) {
      if (this.attempts.has(attempt.attemptId) || !this.tasks.has(attempt.taskId)) {
        throw new ProductionCoreError(
          `invalid restored attempt: ${attempt.attemptId}`,
          'INVALID_RUNTIME_SNAPSHOT',
        )
      }
      this.attempts.set(attempt.attemptId, mutableAttempt(attempt))
    }
    for (const generation of snapshot.generations) {
      if (this.generations.has(generation.generationId)
        || !this.tasks.has(generation.taskId)
        || !this.attempts.has(generation.attemptId)) {
        throw new ProductionCoreError(
          `invalid restored generation: ${generation.generationId}`,
          'INVALID_RUNTIME_SNAPSHOT',
        )
      }
      this.generations.set(generation.generationId, mutableGeneration(generation))
    }

    for (const task of this.tasks.values()) {
      for (const attemptId of task.attemptIds) {
        if (this.attempts.get(attemptId)?.taskId !== task.taskId) {
          throw new ProductionCoreError(
            `task ${task.taskId} references invalid attempt ${attemptId}`,
            'INVALID_RUNTIME_SNAPSHOT',
          )
        }
      }
      for (const generationId of task.generationIds) {
        if (this.generations.get(generationId)?.taskId !== task.taskId) {
          throw new ProductionCoreError(
            `task ${task.taskId} references invalid generation ${generationId}`,
            'INVALID_RUNTIME_SNAPSHOT',
          )
        }
      }
      if (task.selectedGenerationId !== null
        && this.generations.get(task.selectedGenerationId)?.taskId !== task.taskId) {
        throw new ProductionCoreError(
          `task ${task.taskId} has invalid selected generation ${task.selectedGenerationId}`,
          'INVALID_RUNTIME_SNAPSHOT',
        )
      }
    }
  }

  private requireTask(taskId: ProductionTaskId): MutableTask {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new ProductionCoreError(`task not found: ${taskId}`, 'TASK_NOT_FOUND')
    return task
  }

  private requireAttempt(attemptId: ProductionAttemptId): MutableAttempt {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) {
      throw new ProductionCoreError(`attempt not found: ${attemptId}`, 'ATTEMPT_NOT_FOUND')
    }
    return attempt
  }

  private requireGeneration(generationId: GenerationId): MutableGeneration {
    const generation = this.generations.get(generationId)
    if (generation === undefined) {
      throw new ProductionCoreError(`generation not found: ${generationId}`, 'GENERATION_NOT_FOUND')
    }
    return generation
  }
}
