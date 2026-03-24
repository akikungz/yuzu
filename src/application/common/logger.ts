export interface AppLogger {
	child(bindings: Record<string, unknown>): AppLogger;
	trace(obj: unknown, msg?: string): void;
	trace(msg: string): void;
	debug(obj: unknown, msg?: string): void;
	debug(msg: string): void;
	info(obj: unknown, msg?: string): void;
	info(msg: string): void;
	warn(obj: unknown, msg?: string): void;
	warn(msg: string): void;
	error(obj: unknown, msg?: string): void;
	error(msg: string): void;
}
