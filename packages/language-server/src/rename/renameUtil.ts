import { Position } from 'vscode-languageserver'
import { TextEdit, TextDocument } from 'vscode-languageserver-textdocument'
import {
  getCurrentLine,
  Block,
  getBlockAtPosition,
  getWordAtPosition,
} from '../MessageHandler'
import { getTypesFromCurrentBlock } from '../completion/completions'

function extractFirstWord(line: string): string {
  return line.replace(/ .*/, '')
}

export function extractModelName(line: string): string {
  const blockType = extractFirstWord(line)
  return line.slice(blockType.length, line.length - 1).trim()
}

export function isFieldName(
  currentLine: string,
  position: Position,
  currentBlock: Block,
  document: TextDocument,
): boolean {
  if (
    currentBlock.type !== 'model' ||
    position.line == currentBlock.start.line ||
    position.line == currentBlock.end.line
  ) {
    return false
  }
  if (currentLine.startsWith('@')) {
    return false
  }

  // check if position is inside first word
  const currentLineUntrimmed = getCurrentLine(document, position.line)
  const firstWord = extractFirstWord(currentLine)
  const indexOfFirstWord = currentLineUntrimmed.indexOf(firstWord)

  return (
    indexOfFirstWord <= position.character &&
    indexOfFirstWord + firstWord.length >= position.character
  )
}

export function isModelName(position: Position, block: Block): boolean {
  if (position.line !== block.start.line) {
    return false
  }
  return position.character > 5
}

export function printLogMessage(
  currentName: string,
  newName: string,
  isEnumRename: boolean,
  isModelRename: boolean,
  isFieldRename: boolean,
  isEnumValueRename: boolean,
): void {
  const message = `'${currentName}' was renamed to '${newName}'`
  let typeOfRename = ''
  if (isEnumRename) {
    typeOfRename = 'Enum '
  } else if (isFieldRename) {
    typeOfRename = 'Field '
  } else if (isModelRename) {
    typeOfRename = 'Model '
  } else if (isEnumValueRename) {
    typeOfRename = 'Enum value '
  }
  console.log(typeOfRename + message)
}

export function isEnumName(position: Position, block: Block): boolean {
  if (position.line !== block.start.line) {
    return false
  }
  return position.character > 4
}

export function isEnumValue(
  currentLine: string,
  position: Position,
  currentBlock: Block,
  document: TextDocument,
): boolean {
  return (
    currentBlock.type === 'enum' &&
    position.line !== currentBlock.start.line &&
    !currentLine.startsWith('@@') &&
    !getWordAtPosition(document, position).startsWith('@')
  )
}

function insertInlineRename(currentName: string, line: number): TextEdit {
  return {
    range: {
      start: {
        line: line,
        character: Number.MAX_VALUE,
      },
      end: {
        line: line,
        character: Number.MAX_VALUE,
      },
    },
    newText: ' @map("' + currentName + '")',
  }
}

function insertMapBlockAttribute(oldName: string, block: Block): TextEdit {
  return {
    range: {
      start: {
        line: block.end.line,
        character: 0,
      },
      end: block.end,
    },
    newText: '\t@@map("' + oldName + '")\n}',
  }
}

function positionIsNotInsideSearchedBlocks(
  line: number,
  searchedBlocks: Block[],
): boolean {
  if (searchedBlocks.length === 0) {
    return true
  }
  return !searchedBlocks.some(
    (block) => line >= block.start.line && line <= block.end.line,
  )
}

/**
 * Renames references in any '@@index', '@@id' and '@@unique' attributes in the same model.
 * Renames references in any referenced fields inside a '@relation' attribute in the same model (fields: []).
 * Renames references inside a '@relation' attribute in other model blocks (references: []).
 */
export function renameReferencesForFieldValue(
  currentValue: string,
  newName: string,
  document: TextDocument,
  lines: string[],
  block: Block,
): TextEdit[] {
  const edits: TextEdit[] = []
  const searchStringsSameBlock = ['@@index', '@@id', '@@unique']
  const relationAttribute = '@relation'
  // search in same model first
  let reachedStartLine = false
  for (const [key, item] of lines.entries()) {
    if (key === block.start.line + 1) {
      reachedStartLine = true
    }
    if (!reachedStartLine) {
      continue
    }
    if (key === block.end.line) {
      break
    }
    if (item.includes(relationAttribute) && item.includes(currentValue)) {
      // search for fields references
      const currentLineUntrimmed = getCurrentLine(document, key)
      const indexOfFieldsStart = currentLineUntrimmed.indexOf('fields:')
      const indexOfFieldEnd =
        currentLineUntrimmed.slice(indexOfFieldsStart).indexOf(']') +
        indexOfFieldsStart
      const fields = currentLineUntrimmed.slice(
        indexOfFieldsStart,
        indexOfFieldEnd,
      )
      const indexOfFoundValue = fields.indexOf(currentValue)
      if (indexOfFoundValue !== -1) {
        // found a referenced field
        edits.push({
          range: {
            start: {
              line: key,
              character: indexOfFieldsStart + indexOfFoundValue,
            },
            end: {
              line: key,
              character:
                indexOfFieldsStart + indexOfFoundValue + currentValue.length,
            },
          },
          newText: newName,
        })
      }
    }
    // search for references in index, id and unique block attributes
    if (
      searchStringsSameBlock.some((s) => item.includes(s)) &&
      item.includes(currentValue)
    ) {
      const currentLineUntrimmed = getCurrentLine(document, key)
      const indexOfCurrentValue = currentLineUntrimmed.indexOf(currentValue)
      edits.push({
        range: {
          start: {
            line: key,
            character: indexOfCurrentValue,
          },
          end: {
            line: key,
            character: indexOfCurrentValue + currentValue.length,
          },
        },
        newText: newName,
      })
    }
  }

  // search for references in other model blocks
  for (const [index, value] of lines.entries()) {
    if (
      value.includes(block.name) &&
      value.includes(currentValue) &&
      value.includes(relationAttribute)
    ) {
      const currentLineUntrimmed = getCurrentLine(document, index)
      // get the index of the second word
      const indexOfReferences = currentLineUntrimmed.indexOf('references:')
      const indexOfReferencesEnd =
        currentLineUntrimmed.slice(indexOfReferences).indexOf(']') +
        indexOfReferences
      const references = currentLineUntrimmed.slice(
        indexOfReferences,
        indexOfReferencesEnd,
      )
      const indexOfFoundValue = references.indexOf(currentValue)
      if (references.includes(currentValue)) {
        edits.push({
          range: {
            start: {
              line: index,
              character: indexOfReferences + indexOfFoundValue,
            },
            end: {
              line: index,
              character:
                indexOfReferences + indexOfFoundValue + currentValue.length,
            },
          },
          newText: newName,
        })
      }
    }
  }

  return edits
}

/**
 * Renames references where the current enum value is used as a default value in other model blocks.
 */
export function renameReferencesForEnumValue(
  currentValue: string,
  newName: string,
  document: TextDocument,
  lines: string[],
  enumName: string,
): TextEdit[] {
  const edits: TextEdit[] = []
  const searchString = '@default(' + currentValue + ')'

  for (const [index, value] of lines.entries()) {
    if (value.includes(searchString) && value.includes(enumName)) {
      const currentLineUntrimmed = getCurrentLine(document, index)
      // get the index of the second word
      const indexOfCurrentName = currentLineUntrimmed.indexOf(searchString)
      edits.push({
        range: {
          start: {
            line: index,
            character: indexOfCurrentName,
          },
          end: {
            line: index,
            character: indexOfCurrentName + searchString.length,
          },
        },
        newText: '@default(' + newName + ')',
      })
    }
  }
  return edits
}

/**
 * Renames references where the model name is used as a relation type in the same and other model blocks.
 */
export function renameReferencesForModelName(
  currentName: string,
  newName: string,
  document: TextDocument,
  lines: string[],
): TextEdit[] {
  const searchedBlocks = []
  const edits: TextEdit[] = []

  for (const [index, value] of lines.entries()) {
    // check if inside model
    if (
      value.includes(currentName) &&
      positionIsNotInsideSearchedBlocks(index, searchedBlocks)
    ) {
      const block = getBlockAtPosition(index, lines)
      if (block && block.type == 'model') {
        searchedBlocks.push(block)
        // search block for references
        const types: Map<string, number> = getTypesFromCurrentBlock(
          lines,
          block,
        )
        for (const f of types.keys()) {
          if (f.replace('?', '').replace('[]', '') === currentName) {
            // replace here
            const line = types.get(f)
            if (!line) {
              return edits
            }
            const currentLineUntrimmed = getCurrentLine(document, line)
            const wordsInLine: string[] = lines[line].split(/\s+/)
            // get the index of the second word
            const indexOfFirstWord = currentLineUntrimmed.indexOf(
              wordsInLine[0],
            )
            const indexOfCurrentName = currentLineUntrimmed.indexOf(
              currentName,
              indexOfFirstWord + wordsInLine[0].length,
            )
            edits.push({
              range: {
                start: {
                  line: line,
                  character: indexOfCurrentName,
                },
                end: {
                  line: line,
                  character: indexOfCurrentName + currentName.length,
                },
              },
              newText: newName,
            })
          }
        }
      }
    }
  }
  return edits
}

function mapFieldAttributeExistsAlready(line: string): boolean {
  return line.includes('@map(')
}

function mapBlockAttributeExistsAlready(
  block: Block,
  lines: string[],
): boolean {
  let reachedStartLine = false
  for (const [key, item] of lines.entries()) {
    if (key === block.start.line + 1) {
      reachedStartLine = true
    }
    if (!reachedStartLine) {
      continue
    }
    if (key === block.end.line) {
      break
    }
    if (item.startsWith('@@map(')) {
      return true
    }
  }
  return false
}

export function insertBasicRename(
  newName: string,
  currentName: string,
  document: TextDocument,
  line: number,
): TextEdit {
  const currentLineUntrimmed = getCurrentLine(document, line)
  const indexOfCurrentName = currentLineUntrimmed.indexOf(currentName)

  return {
    range: {
      start: {
        line: line,
        character: indexOfCurrentName,
      },
      end: {
        line: line,
        character: indexOfCurrentName + currentName.length,
      },
    },
    newText: newName,
  }
}

export function mapExistsAlready(
  currentLine: string,
  lines: string[],
  block: Block,
  isModelOrEnumRename: boolean,
): boolean {
  if (isModelOrEnumRename) {
    return mapBlockAttributeExistsAlready(block, lines)
  } else {
    return mapFieldAttributeExistsAlready(currentLine)
  }
}

export function insertMapAttribute(
  currentName: string,
  position: Position,
  block: Block,
  isModelOrEnumRename: boolean,
): TextEdit {
  if (isModelOrEnumRename) {
    return insertMapBlockAttribute(currentName, block)
  } else {
    return insertInlineRename(currentName, position.line)
  }
}

export function extractCurrentName(
  line: string,
  isModelOrEnumRename: boolean,
  isEnumValueRename: boolean,
  isFieldRename: boolean,
): string {
  if (isModelOrEnumRename) {
    return extractModelName(line)
  }
  if (isEnumValueRename || isFieldRename) {
    return extractFirstWord(line)
  }
  return ''
}