import { createContext, useContext, useState } from 'react'

const ViewModeContext = createContext({ isClientView: false, setIsClientView: () => {} })

export function ViewModeProvider({ children }) {
  const [isClientView, setIsClientView] = useState(false)
  return (
    <ViewModeContext.Provider value={{ isClientView, setIsClientView }}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  return useContext(ViewModeContext)
}
