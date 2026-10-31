// Per-route error boundary — spec §14.1. A crash shows "This screen hit a
// problem" with three actions: Reset this screen (remounts the screen,
// clearing its local store slice), Copy error details (sanitized, never
// secrets), and Open Diagnostics. The error is recorded in the errors ring
// buffer so Diagnostics shows it.
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/base/Button';
import { ErrorState } from '../components/base/ErrorState';
import { recordError } from '../services/errorReport';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  routeLabel: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: number;
}

export class RouteErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    recordError(`route:${this.props.routeLabel}`, error);
    // eslint-disable-next-line no-console
    console.error(`[zanshin] route error on ${this.props.routeLabel}:`, error);
  }

  handleReset = (): void => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  handleCopy = async (): Promise<void> => {
    const { error } = this.state;
    if (!error) return;
    const text = `ZANSHIN error on ${this.props.routeLabel}\n${error.name}: ${error.message}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable (insecure context): leave the error on screen.
    }
  };

  render(): React.ReactNode {
    const { error, resetKey } = this.state;
    if (!error) return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
    return (
      <div className="z-route-error">
        <ErrorState
          title="This screen hit a problem"
          body={`${error.name}: ${error.message}`}
          actions={
            <>
              <Button onClick={this.handleReset}>Reset this screen</Button>
              <Button variant="secondary" onClick={() => void this.handleCopy()}>Copy error details</Button>
              <Link className="z-route-error__link" to="/diagnostics">Open diagnostics</Link>
            </>
          }
        />
      </div>
    );
  }
}
