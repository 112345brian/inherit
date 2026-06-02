// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml');
export const parseYaml = (s: string) => yaml.load(s);
export const stringifyYaml = (obj: unknown) => yaml.dump(obj);
