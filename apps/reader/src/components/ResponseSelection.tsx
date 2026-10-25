import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { Operation } from '@davidniessen/doctopus-contracts';

function useResponseState(operation: Operation) {
  const [status, changeStatus] = useState(
    operation.responses[0]?.status ?? '200',
  );
  const [type, changeType] = useState('');
  const [example, setExample] = useState<string>();
  const response =
    operation.responses.find((item) => item.status === status) ??
    operation.responses[0];
  const types = Object.keys(response?.content ?? {});
  return {
    operation,
    response,
    status,
    types,
    type: types.includes(type) ? type : (types[0] ?? ''),
    example,
    setExample,
    setStatus(value: string) {
      changeStatus(value);
      changeType('');
      setExample(undefined);
    },
    setType(value: string) {
      changeType(value);
      setExample(undefined);
    },
  };
}
const ResponseContext = createContext<
  ReturnType<typeof useResponseState> | undefined
>(undefined);

export function ResponseSelectionProvider({
  operation,
  children,
}: {
  operation: Operation;
  children: ReactNode;
}) {
  const selection = useResponseState(operation);
  return (
    <ResponseContext.Provider value={selection}>
      {children}
    </ResponseContext.Provider>
  );
}

/** Classic endpoint cards retain independent selections outside a page provider. */
export function useResponseSelection(operation: Operation) {
  const shared = useContext(ResponseContext);
  const local = useResponseState(operation);
  return shared?.operation === operation ? shared : local;
}
