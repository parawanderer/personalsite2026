import { LoadingManager, Texture, TextureLoader as ThreeTextureLoader, Wrapping } from "three";

const TEXTURE_CACHE = new Map();

export interface TextureOptions {
    wrapS?: Wrapping;
    wrapT?: Wrapping;
    colorSpace?: string;
}

export interface PBRMaterial {
    map: Texture;
    normalMap?: Texture;
    specularColorMap?: Texture;
    aoMap?: Texture;
}

export const PLACEHOLDER = '${PLACEHOLDER}';

const DIFFUSE = 'diffuse';
const NORMAL = 'normal';
const SPECULAR = 'specular';
const AO = 'ao';


export class TextureLoader {
    constructor(private loadingMgr: LoadingManager) {}

    public getTexture(pathToTexture: string, options?: TextureOptions): Texture {
        if (TEXTURE_CACHE.has(pathToTexture)) {
            return TEXTURE_CACHE.get(pathToTexture);
        }

        const texture = new ThreeTextureLoader(this.loadingMgr).load(pathToTexture);

        if (options) {
            if (options.wrapS) texture.wrapS = options.wrapS;
            if (options.wrapT) texture.wrapT = options.wrapT;
            if (options.colorSpace) texture.colorSpace = options.colorSpace;
        }

        TEXTURE_CACHE.set(pathToTexture, texture);
        return texture;
    }

    public getPBRMaterialTextures(basePathPattern: string, options?: TextureOptions) : PBRMaterial {
        if (!basePathPattern.includes(PLACEHOLDER)) {
            throw new Error(`input string basePathPattern = '${basePathPattern}' did not contain \${PLACEHOLDER} anywhere within it!`);
        }

        const map: Texture = this.getTexture(basePathPattern.replace(PLACEHOLDER, DIFFUSE), options);
        // the other maps wrap like the colour one, but stay in linear space (they're data, not colours)
        const dataOptions: TextureOptions | undefined = options && { wrapS: options.wrapS, wrapT: options.wrapT };
        const normalMap: Texture = this.getTexture(basePathPattern.replace(PLACEHOLDER, NORMAL), dataOptions);
        const specularColorMap: Texture = this.getTexture(basePathPattern.replace(PLACEHOLDER, SPECULAR), dataOptions);
        const aoMap: Texture = this.getTexture(basePathPattern.replace(PLACEHOLDER, AO), dataOptions);

        const ret = {
            map,
            normalMap,
            specularColorMap,
            aoMap,
        };

        //console.log(ret);

        return ret;
    }
}