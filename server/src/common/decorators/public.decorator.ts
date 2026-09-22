import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../libs/constants/metadata.constant';

// Marks a route as exempt from the global JwtAuthGuard (see RbacModule).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
