/** Kinds a single argument/result value can be classified as for display purposes. */
export type SerializedArgKind =
  | 'number'
  | 'enum'
  | 'boolean'
  | 'string'
  | 'typedarray'
  | 'array'
  | 'globject'
  | 'null'
  | 'undefined'
  | 'other';

/** A single argument or return value, captured in a display-friendly and a raw form. */
export interface SerializedArg {
  kind: SerializedArgKind;
  /** Human-readable rendering, e.g. "TEXTURE_2D" or "GLObject#3 (WebGLTexture)". */
  display: string;
  /** The raw numeric/boolean/string value, a cloned typed array, or a GLObjectRef. Never the original mutable object. */
  raw: unknown;
}

/** A stable reference to a WebGL "handle" object (WebGLTexture, WebGLBuffer, ...). */
export interface GLObjectRef {
  id: number;
  type: string;
  /** How this id first came to be assigned. */
  origin: 'created' | 'unknown';
}

/** One recorded WebGL call. */
export interface GLCall {
  /** Sequential index within the recording, starting at 0. */
  id: number;
  name: string;
  args: SerializedArg[];
  result: SerializedArg | undefined;
  /** Set when this call created a new GL handle (see object registry rules). */
  objectId?: number;
  /** Set when the underlying call threw; the call is still recorded. */
  threwError?: string;
  timestamp: number;
}

export interface RecordingOptions {
  /** Called every time a new GLCall is recorded. */
  onCall?: (call: GLCall) => void;
}
