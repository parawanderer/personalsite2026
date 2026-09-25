export function getByIdOrThrow<T extends Element = HTMLElement>(id: string): T {
    const element = document.getElementById(id) as unknown as T | null;
    if (element === null)
        throw new Error(`Element with id '${id}' could not be found in document`);
    return element;
}
