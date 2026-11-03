import React from 'react';

export default class GanttErrorBoundary extends React.Component {
  state = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Gantt page failed to render.', error);
  }

  retry = () => {
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <section className="gantt-error-state" role="alert">
          <div>
            <strong>Gantt could not be displayed</strong>
            <p>The chart encountered a rendering error. You can retry this page.</p>
          </div>
          <button className="secondary-button" onClick={this.retry} type="button">
            Retry Gantt
          </button>
        </section>
      );
    }

    // eslint-disable-next-line react/prop-types
    return React.cloneElement(React.Children.only(this.props.children), {
      key: this.state.retryKey,
    });
  }
}
