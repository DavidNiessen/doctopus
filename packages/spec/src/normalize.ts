import { Ajv2020 } from 'ajv/dist/2020.js';
import { normalizeDocument } from './normalize-document.js';
const schemaValidator = new Ajv2020({ strict: false, validateFormats: false });
/** Node build-time normalization retains full JSON Schema meta-validation. */
export function normalizeSpec(
  document: Record<string, unknown>,
  input: { id: string; path: string; version?: string },
) {
  return normalizeDocument(document, input, (schema, source) => {
    if (!schemaValidator.validateSchema(schema))
      throw new Error(
        `${input.path} (${source}): invalid JSON Schema: ${schemaValidator.errorsText()}`,
      );
  });
}
