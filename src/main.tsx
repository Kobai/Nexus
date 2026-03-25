import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message + '\n' + e.stack }
  }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ color: '#f88', padding: '1rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px' }}>
          {this.state.error}
        </pre>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
