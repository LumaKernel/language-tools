import {
  CompletionItem,
  CompletionList,
  CompletionItemKind,
} from 'vscode-languageserver'
import { Schema, DataSource, Block, Generator } from 'prismafile/dist/ast'

function toCompletionItems(
  allowedTypes: string[],
  kind: CompletionItemKind,
): CompletionItem[] {
  const items: CompletionItem[] = []
  allowedTypes.forEach((type) => items.push({ label: type, kind: kind }))
  return items
}

/**
 * @todo check if in 'embed' blocks
 */
function getSuggestionForBlockAttribute(block: Block): Array<string> {
  if (block.type != 'model') {
    return []
  }
  return [
    'map(_ name: String)',
    'id(_ fields: Identifier[])',
    'unique(_ fields: Identifier[], name: String?)',
    'index(_ fields: Identifier[], name: String?)',
  ]
}

/**
 *
 * @todo check if in 'embed' block
 */
function getSuggestionForFieldAttribute(block: Block): Array<string> {
  if (block.type != 'model' && block.type != 'type_alias') {
    return []
  }
  return [
    'id',
    'unique',
    'map(_ name: String)',
    'default(_expr: Expr)',
    'relation(_ name?:String, references?: Identifier[], onDelete?: CascadeEnum)',
  ]
}

export function getSuggestionsForAttributes(
  token: string,
  block: Block,
): CompletionList {
  const labels = token.startsWith('@@')
    ? getSuggestionForBlockAttribute(block)
    : getSuggestionForFieldAttribute(block)

  return {
    items: toCompletionItems(labels, CompletionItemKind.Property),
    isIncomplete: true,
  }
}

/**
 * @todo get modelNames except the modelName we are currently in
 */
export function getSuggestionsForTypes(
  ast: Schema,
  foundBlock: Block,
): CompletionList {
  const coreTypes = ['String', 'Int', 'Boolean', 'Float', 'DateTime']
  const relationTypes = ast.blocks
    .filter((block) => block.type === 'model')
    .map((model) => model.name)
    .filter((modelName) => modelName != foundBlock.name)

  const allowedTypes = coreTypes.concat(relationTypes)

  return {
    items: toCompletionItems(allowedTypes, CompletionItemKind.TypeParameter),
    isIncomplete: false,
  }
}

function getSuggestionForDataSourceField(block: DataSource): string[] {
  const supportedFields = ['provider', 'url']

  block.assignments.forEach((toRemove) => {
    const index = supportedFields.indexOf(toRemove.key)
    supportedFields.splice(index, 1)
  })

  return supportedFields
}

function getSuggestionForGeneratorField(block: Generator): string[] {
  const supportedFields = ['provider', 'output']

  block.assignments.forEach((toRemove) => {
    const index = supportedFields.indexOf(toRemove.key)
    supportedFields.splice(index, 1)
  })

  return supportedFields
}

/**
 *
 * @todo add suggestions for type-alias and enum
 * @param foundBlock
 */
export function getSuggestionForField(
  ast: Schema,
  foundBlock: Block,
): CompletionList {
  let result: string[] = []
  switch (foundBlock.type) {
    case 'datasource':
      result = getSuggestionForDataSourceField(foundBlock)
      break
    case 'generator':
      result = getSuggestionForGeneratorField(foundBlock)
      break
    case 'model':
    case 'type_alias':
    case 'enum':
      result = []
      break
  }
  return {
    items: toCompletionItems(result, CompletionItemKind.Field),
    isIncomplete: false,
  }
}

/**
 *
 * @todo add enum once supported!
 */
export function getSuggestionForBlockTypes(ast: Schema): CompletionList {
  const allowedBlockTypes = ['datasource', 'generator', 'model', 'type_alias']

  return {
    items: toCompletionItems(allowedBlockTypes, CompletionItemKind.Class),
    isIncomplete: true,
  }
}

/**
 * @todo check if position is inside relation not e.g. in List Type
 * @todo exclude field of current line
 */
export function getSuggestionsForRelation(
  block: Block,
  currentLine: string,
): CompletionList | undefined {
  if (block.type != 'model' || !currentLine.includes('@relation(')) {
    return undefined
  }
  const suggestions = block.properties.map((prop) => prop.name)

  return {
    items: toCompletionItems(suggestions, CompletionItemKind.Field),
    isIncomplete: true,
  }
}