interface ArmorInspectionDependencies {
  setVisible(visible: boolean): void;
  startCamera(): Promise<void>;
  stopCamera(): void;
  resetGestures(): void;
  setDispersal(value: number): void;
}

export function shouldApplyGestureStatus(cameraRequested: boolean, status: 'off' | 'requesting' | 'tracking' | 'error'): boolean {
  return status === 'off' || cameraRequested;
}

export class ArmorInspection {
  private readonly dependencies: ArmorInspectionDependencies;
  active = false;

  constructor(dependencies: ArmorInspectionDependencies) {
    this.dependencies = dependencies;
  }

  async enter(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.dependencies.resetGestures();
    this.dependencies.setDispersal(0);
    this.dependencies.setVisible(true);
    await this.dependencies.startCamera();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.dependencies.stopCamera();
    this.dependencies.resetGestures();
    this.dependencies.setDispersal(0);
    this.dependencies.setVisible(false);
  }
}
