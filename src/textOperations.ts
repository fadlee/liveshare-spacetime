export type ClientTextOperation =
  | { tag: 'Insert'; value: { position: bigint; text: string } }
  | { tag: 'Delete'; value: { position: bigint; length: bigint } };

export function createOperationsFromChange(
  previousText: string,
  nextText: string
): ClientTextOperation[] {
  if (previousText === nextText) return [];

  let prefixLength = 0;
  while (
    prefixLength < previousText.length &&
    prefixLength < nextText.length &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength &&
    suffixLength < nextText.length - prefixLength &&
    previousText[previousText.length - 1 - suffixLength] ===
      nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const removedLength = previousText.length - prefixLength - suffixLength;
  const insertedText = nextText.slice(
    prefixLength,
    nextText.length - suffixLength
  );
  const operations: ClientTextOperation[] = [];

  if (removedLength > 0) {
    operations.push({
      tag: 'Delete',
      value: { position: BigInt(prefixLength), length: BigInt(removedLength) },
    });
  }

  if (insertedText.length > 0) {
    operations.push({
      tag: 'Insert',
      value: { position: BigInt(prefixLength), text: insertedText },
    });
  }

  return operations;
}

export function applyLocalOperation(
  text: string,
  operation: ClientTextOperation
): string {
  if (operation.tag === 'Insert') {
    const position = Number(operation.value.position);
    return `${text.slice(0, position)}${operation.value.text}${text.slice(position)}`;
  }

  const position = Number(operation.value.position);
  const end = position + Number(operation.value.length);
  return `${text.slice(0, position)}${text.slice(end)}`;
}

export function applyLocalOperations(
  text: string,
  operations: ClientTextOperation[]
): string {
  return operations.reduce(applyLocalOperation, text);
}

export function replayOperations(
  serverText: string,
  pendingOperations: ClientTextOperation[]
): string {
  return applyLocalOperations(serverText, pendingOperations);
}
