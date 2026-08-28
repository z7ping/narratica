export type StoryCoreErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'INVALID_PROJECT_MANIFEST'
  | 'DUPLICATE_PROJECT_ID'
  | 'INVALID_STORY_TARGET'
  | 'INVALID_DRAFT_CONTENT'
  | 'DRAFT_ALREADY_EXISTS'
  | 'DRAFT_NOT_FOUND'
  | 'CANONICAL_NOT_FOUND'
  | 'CANONICAL_ALREADY_EXISTS'
  | 'REVISION_CONFLICT'
  | 'MISSING_PROSE_SOURCE'
  | 'REVIEW_NOT_READY'

export class StoryCoreError extends Error {
  readonly code: StoryCoreErrorCode

  constructor(message: string, code: StoryCoreErrorCode) {
    super(message)
    this.name = 'StoryCoreError'
    this.code = code
  }
}
